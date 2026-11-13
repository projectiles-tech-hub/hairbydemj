package com.hairbydemj.hairbydemj

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.net.Uri
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.ar.core.ArCoreApk
import com.google.ar.core.AugmentedFace
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.EnumSet
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

class MainActivity : FlutterActivity() {
    private var pendingCamera: MethodChannel.Result? = null
    private var userAskedInstall = true

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        flutterEngine.platformViewsController.registry.registerViewFactory("hairbydemj/try-on-view", TryOnViewFactory(this))
        EventChannel(messenger, "hairbydemj/try-on-faces").setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) { TryOn.sink = events }
            override fun onCancel(arguments: Any?) { TryOn.sink = null }
        })
        MethodChannel(messenger, "hairbydemj/try-on").setMethodCallHandler { call, result ->
            when (call.method) {
                "availability" -> result.success(availability())
                "cameraPermission" -> result.success(cameraPermission())
                "requestCamera" -> {
                    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        result.success(true)
                    } else {
                        pendingCamera = result
                        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), CAMERA_REQUEST)
                    }
                }
                "openSettings" -> {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
                    result.success(null)
                }
                "snapshot" -> {
                    val view = TryOn.view
                    if (view == null) result.success(null) else view.snapshot { png -> result.success(png) }
                }
                "savePhoto" -> result.success(savePhoto(call.arguments as? ByteArray))
                else -> result.notImplemented()
            }
        }
    }

    /** "ready", "installing" (Google Play Services for AR is being fetched) or "unsupported". */
    private fun availability(): String {
        return try {
            val check = ArCoreApk.getInstance().checkAvailability(this)
            if (check.isTransient) return "installing"
            if (!check.isSupported) return "unsupported"
            when (ArCoreApk.getInstance().requestInstall(this, userAskedInstall)) {
                ArCoreApk.InstallStatus.INSTALLED -> "ready"
                else -> {
                    userAskedInstall = false
                    "installing"
                }
            }
        } catch (e: Exception) {
            "unsupported"
        }
    }

    private fun cameraPermission(): String {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) return "granted"
        val asked = getSharedPreferences("try_on", MODE_PRIVATE).getBoolean("asked", false)
        // Asked before and the phone would no longer show the prompt: refused.
        return if (asked && !ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.CAMERA)) "denied" else "unknown"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CAMERA_REQUEST) return
        getSharedPreferences("try_on", MODE_PRIVATE).edit().putBoolean("asked", true).apply()
        pendingCamera?.success(grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)
        pendingCamera = null
    }

    private fun savePhoto(png: ByteArray?): Boolean {
        if (png == null) return false
        return try {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "hairbydemj-${System.currentTimeMillis()}.png")
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/hairbydemj")
            }
            val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
            contentResolver.openOutputStream(uri)?.use { it.write(png) } ?: return false
            true
        } catch (e: Exception) {
            false
        }
    }

    companion object {
        private const val CAMERA_REQUEST = 4021
    }
}

// ----- Try-on (module 16) -----
//
// ARCore Augmented Faces with the front camera. The camera picture is drawn
// here with OpenGL; Flutter only receives where the two temples are on the
// view, and draws the wig there (lib/screens/try_on.dart). Nothing leaves
// the phone.

object TryOn {
    var sink: EventChannel.EventSink? = null
    var view: TryOnView? = null
}

class TryOnViewFactory(private val activity: Activity) : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    override fun create(context: Context, viewId: Int, args: Any?): PlatformView = TryOnView(activity)
}

class TryOnView(private val activity: Activity) : PlatformView, GLSurfaceView.Renderer {
    private val surface = GLSurfaceView(activity)
    private val main = Handler(Looper.getMainLooper())
    private var session: Session? = null
    private var width = 1
    private var height = 1
    private var cameraTexture = 0
    private var program = 0
    private val quad: FloatBuffer = floats(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
    private val uvs: FloatBuffer = floats(FloatArray(8))
    private var wantSnapshot: ((ByteArray?) -> Unit)? = null
    private val density = activity.resources.displayMetrics.density

    init {
        TryOn.view = this
        surface.preserveEGLContextOnPause = true
        surface.setEGLContextClientVersion(2)
        surface.setRenderer(this)
        surface.renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        try {
            val s = Session(activity, EnumSet.of(Session.Feature.FRONT_CAMERA))
            val config = Config(s).apply {
                augmentedFaceMode = Config.AugmentedFaceMode.MESH3D
                updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
            }
            s.configure(config)
            s.resume()
            session = s
        } catch (e: Exception) {
            main.post { TryOn.sink?.error("unavailable", e.message, null) }
        }
    }

    override fun getView(): View = surface

    override fun dispose() {
        if (TryOn.view === this) TryOn.view = null
        surface.onPause()
        session?.pause()
        session?.close()
        session = null
    }

    fun snapshot(done: (ByteArray?) -> Unit) {
        wantSnapshot = done
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        cameraTexture = textures[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTexture)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        program = link(
            "attribute vec4 a_Position; attribute vec2 a_TexCoord; varying vec2 v_TexCoord; void main() { gl_Position = a_Position; v_TexCoord = a_TexCoord; }",
            "#extension GL_OES_EGL_image_external : require\nprecision mediump float; varying vec2 v_TexCoord; uniform samplerExternalOES s_Texture; void main() { gl_FragColor = texture2D(s_Texture, v_TexCoord); }",
        )
        session?.setCameraTextureName(cameraTexture)
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        width = w
        height = h
        GLES20.glViewport(0, 0, w, h)
        @Suppress("DEPRECATION")
        val rotation = (activity.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.rotation
        session?.setDisplayGeometry(rotation, w, h)
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val s = session ?: return
        val frame = try { s.update() } catch (e: Exception) { return }
        if (frame.hasDisplayGeometryChanged()) {
            quad.position(0)
            uvs.position(0)
            frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, quad, Coordinates2d.TEXTURE_NORMALIZED, uvs)
        }
        if (frame.timestamp == 0L) return
        drawCamera()
        wantSnapshot?.let { done ->
            wantSnapshot = null
            val png = readPixels()
            main.post { done(png) }
        }

        val camera = frame.camera
        if (camera.trackingState != TrackingState.TRACKING) return
        val face = s.getAllTrackables(AugmentedFace::class.java).firstOrNull { it.trackingState == TrackingState.TRACKING }
        if (face == null) {
            main.post { TryOn.sink?.success(mapOf("found" to false)) }
            return
        }
        val view = FloatArray(16)
        val projection = FloatArray(16)
        val vp = FloatArray(16)
        camera.getViewMatrix(view, 0)
        camera.getProjectionMatrix(projection, 0, 0.05f, 100f)
        android.opengl.Matrix.multiplyMM(vp, 0, projection, 0, view, 0)
        // ARCore's forehead regions sit at the temples' height, a little inwards;
        // they are moved out to the template's temples (docs/try-on.md).
        val left = face.getRegionPose(AugmentedFace.RegionType.FOREHEAD_LEFT)
        val right = face.getRegionPose(AugmentedFace.RegionType.FOREHEAD_RIGHT)
        val a = project(vp, left.compose(com.google.ar.core.Pose.makeTranslation(0.012f, -0.01f, -0.01f)).translation)
        val b = project(vp, right.compose(com.google.ar.core.Pose.makeTranslation(-0.012f, -0.01f, -0.01f)).translation)
        main.post { TryOn.sink?.success(mapOf("found" to true, "ax" to a[0], "ay" to a[1], "bx" to b[0], "by" to b[1])) }
    }

    /** World point to the view's logical pixels. */
    private fun project(vp: FloatArray, p: FloatArray): DoubleArray {
        val out = FloatArray(4)
        android.opengl.Matrix.multiplyMV(out, 0, vp, 0, floatArrayOf(p[0], p[1], p[2], 1f), 0)
        val x = (out[0] / out[3] + 1f) / 2f * width
        val y = (1f - out[1] / out[3]) / 2f * height
        return doubleArrayOf((x / density).toDouble(), (y / density).toDouble())
    }

    private fun drawCamera() {
        GLES20.glUseProgram(program)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTexture)
        val position = GLES20.glGetAttribLocation(program, "a_Position")
        val texCoord = GLES20.glGetAttribLocation(program, "a_TexCoord")
        quad.position(0)
        uvs.position(0)
        GLES20.glVertexAttribPointer(position, 2, GLES20.GL_FLOAT, false, 0, quad)
        GLES20.glVertexAttribPointer(texCoord, 2, GLES20.GL_FLOAT, false, 0, uvs)
        GLES20.glEnableVertexAttribArray(position)
        GLES20.glEnableVertexAttribArray(texCoord)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(position)
        GLES20.glDisableVertexAttribArray(texCoord)
    }

    private fun readPixels(): ByteArray? {
        return try {
            val buffer = ByteBuffer.allocateDirect(width * height * 4).order(ByteOrder.nativeOrder())
            GLES20.glReadPixels(0, 0, width, height, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buffer)
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            buffer.rewind()
            bitmap.copyPixelsFromBuffer(buffer)
            // OpenGL rows start at the bottom.
            val upright = Bitmap.createBitmap(bitmap, 0, 0, width, height, Matrix().apply { preScale(1f, -1f) }, false)
            ByteArrayOutputStream().use { out ->
                upright.compress(Bitmap.CompressFormat.PNG, 100, out)
                out.toByteArray()
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun link(vertex: String, fragment: String): Int {
        fun compile(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, source)
            GLES20.glCompileShader(shader)
            return shader
        }
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, compile(GLES20.GL_VERTEX_SHADER, vertex))
        GLES20.glAttachShader(p, compile(GLES20.GL_FRAGMENT_SHADER, fragment))
        GLES20.glLinkProgram(p)
        return p
    }

    private fun floats(values: FloatArray): FloatBuffer =
        ByteBuffer.allocateDirect(values.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
            put(values)
            position(0)
        }
}
