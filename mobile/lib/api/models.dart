// What the server sends, as small read-only classes. Field names follow the
// server's JSON (see docs/catalogue.md, cart.md, orders.md).

import 'client.dart';

int _int(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
int? _intOrNull(Object? v) => v == null ? null : (v is num ? v.toInt() : int.tryParse('$v'));
String _str(Object? v) => v == null ? '' : '$v';
String? _strOrNull(Object? v) => v == null ? null : '$v';
List<Json> _list(Object? v) => v is List ? v.whereType<Map>().map((m) => m.cast<String, dynamic>()).toList() : const [];
Json? _map(Object? v) => v is Map ? v.cast<String, dynamic>() : null;

class Category {
  Category(Json j)
      : id = _int(j['id']),
        slug = _str(j['slug']),
        name = _str(j['name']),
        description = _str(j['description']),
        productCount = _int(j['productCount']),
        children = _list(j['children']).map(Category.new).toList();
  final int id;
  final String slug;
  final String name;
  final String description;
  final int productCount;
  final List<Category> children;
}

class ProductSummary {
  ProductSummary(Json j)
      : id = _int(j['id'] ?? j['productId']),
        slug = _str(j['slug']),
        name = _str(j['name']),
        image = _map(j['image']),
        currency = _str(j['currency']),
        priceFromMinor = _int(j['priceFromMinor']),
        priceToMinor = _int(j['priceToMinor'] ?? j['priceFromMinor']),
        compareAtMinor = _intOrNull(j['compareAtMinor']),
        inStock = j['inStock'] != false,
        lengths = (j['lengths'] as List?)?.whereType<num>().map((n) => n.toInt()).toList() ?? const [],
        texture = _strOrNull(j['texture']),
        isNew = j['isNew'] == true;
  final int id;
  final String slug;
  final String name;
  final Json? image;
  final String currency;
  final int priceFromMinor;
  final int priceToMinor;
  final int? compareAtMinor;
  final bool inStock;
  final List<int> lengths;
  final String? texture;
  final bool isNew;

  /// "22 inches, Body wave" style line under the name.
  String get detail {
    final parts = <String>[];
    if (lengths.isNotEmpty) parts.add(lengths.length == 1 ? '${lengths.first} inches' : '${lengths.first} to ${lengths.last} inches');
    if (texture != null && texture!.isNotEmpty) parts.add(texture!);
    return parts.join(', ');
  }
}

class ProductPage {
  ProductPage(Json j)
      : products = _list(j['products']).map(ProductSummary.new).toList(),
        nextCursor = _strOrNull(j['nextCursor']),
        total = _int(j['total']),
        corrected = _strOrNull(_map(j['search'])?['corrected']);
  final List<ProductSummary> products;
  final String? nextCursor;
  final int total;
  final String? corrected;
}

class Variant {
  Variant(Json j)
      : id = _int(j['id']),
        sku = _str(j['sku']),
        lengthInches = _intOrNull(j['lengthInches']),
        densityPercent = _intOrNull(j['densityPercent']),
        colour = _strOrNull(j['colour']),
        laceType = _strOrNull(j['laceType']),
        capSize = _strOrNull(j['capSize']),
        priceMinor = _int(j['priceMinor']),
        compareAtMinor = _intOrNull(j['compareAtMinor']),
        available = _int(j['available']),
        lowStock = j['lowStock'] == true;
  final int id;
  final String sku;
  final int? lengthInches;
  final int? densityPercent;
  final String? colour;
  final String? laceType;
  final String? capSize;
  final int priceMinor;
  final int? compareAtMinor;
  final int available;
  final bool lowStock;

  String get description => [
        if (lengthInches != null) '$lengthInches"',
        if (densityPercent != null) '$densityPercent%',
        if (laceType != null) laceType!,
        if (colour != null) colour!,
      ].join(' · ');
}

class MediaItem {
  MediaItem(this.raw)
      : kind = _str(raw['kind']),
        alt = _str(raw['alt']),
        colour = _strOrNull(raw['colour']);
  final Json raw;
  final String kind;
  final String alt;
  final String? colour;
  bool get isVideo => kind == 'video';
}

class Product {
  Product(Json j)
      : id = _int(j['id']),
        slug = _str(j['slug']),
        name = _str(j['name']),
        description = _str(j['description']),
        careGuide = _str(j['careGuide']),
        categoryName = _strOrNull(_map(j['category'])?['name']),
        origin = _strOrNull(j['origin']),
        texture = _strOrNull(j['texture']),
        grade = _strOrNull(j['grade']),
        isFinalSale = j['isFinalSale'] == true,
        currency = _str(j['currency']),
        media = _list(j['media']).map(MediaItem.new).toList(),
        tryOn = _list(j['tryOn']),
        variants = _list(j['variants']).map(Variant.new).toList();
  final int id;
  final String slug;
  final String name;
  final String description;
  final String careGuide;
  final String? categoryName;
  final String? origin;
  final String? texture;
  final String? grade;
  final bool isFinalSale;
  final String currency;
  final List<MediaItem> media;

  /// See-through wig pictures for the camera try-on; empty when it cannot be tried on.
  final List<Json> tryOn;
  final List<Variant> variants;
}

class CartLine {
  CartLine(Json j)
      : id = _int(j['id']),
        variantId = _int(j['variantId']),
        slug = _str(j['slug']),
        name = _str(j['name']),
        description = _str(j['description']),
        image = _map(j['image']),
        quantity = _int(j['quantity']),
        unitMinor = _int(j['unitMinor']),
        lineMinor = _int(j['lineMinor']),
        available = _int(j['available']),
        problem = _strOrNull(j['problem']);
  final int id;
  final int variantId;
  final String slug;
  final String name;
  final String description;
  final Json? image;
  final int quantity;
  final int unitMinor;
  final int lineMinor;
  final int available;
  final String? problem;
}

class Cart {
  Cart(Json j)
      : currency = _str(j['currency']).isEmpty ? 'NGN' : _str(j['currency']),
        lines = _list(j['lines']).map(CartLine.new).toList(),
        itemCount = _int(j['itemCount']),
        subtotalMinor = _int(j['subtotalMinor']),
        discountMinor = _int(j['discountMinor']),
        discounts = _list(j['discounts']).map((d) => _str(d['name'] ?? d['code'])).toList(),
        code = _strOrNull(j['code']),
        freeShipping = j['freeShipping'] == true,
        giftCards = _list(j['giftCards']),
        giftCardMinor = _int(j['giftCardMinor']),
        totalMinor = _int(j['totalMinor']),
        canCheckout = j['canCheckout'] == true;
  Cart.empty([String currency = 'NGN']) : this({'currency': currency});
  final String currency;
  final List<CartLine> lines;
  final int itemCount;
  final int subtotalMinor;
  final int discountMinor;
  final List<String> discounts;
  final String? code;
  final bool freeShipping;
  final List<Json> giftCards;
  final int giftCardMinor;
  final int totalMinor;
  final bool canCheckout;
}

class Address {
  Address({this.id, this.label = '', this.name = '', this.phone = '', this.line1 = '', this.line2 = '', this.city = '', this.region = '', this.postalCode = '', this.country = 'NG', this.isDefault = false});
  Address.fromJson(Json j)
      : id = _intOrNull(j['id']),
        label = _str(j['label']),
        name = _str(j['name']),
        phone = _str(j['phone']),
        line1 = _str(j['line1']),
        line2 = _str(j['line2']),
        city = _str(j['city']),
        region = _str(j['region']),
        postalCode = _str(j['postalCode']),
        country = _str(j['country']).isEmpty ? 'NG' : _str(j['country']),
        isDefault = j['isDefault'] == true;
  final int? id;
  final String label;
  final String name;
  final String phone;
  final String line1;
  final String line2;
  final String city;
  final String region;
  final String postalCode;
  final String country;
  final bool isDefault;

  Json toJson() => {
        if (label.isNotEmpty) 'label': label,
        'name': name,
        'phone': phone,
        'line1': line1,
        if (line2.isNotEmpty) 'line2': line2,
        'city': city,
        if (region.isNotEmpty) 'region': region,
        if (postalCode.isNotEmpty) 'postalCode': postalCode,
        'country': country,
        'isDefault': isDefault,
      };

  String get oneLine => [line1, line2, city, region, postalCode, country].where((s) => s.isNotEmpty).join(', ');
}

class ShippingOption {
  ShippingOption(Json j)
      : id = _str(j['id']),
        carrierName = _str(j['carrierName']),
        serviceName = _str(j['serviceName']),
        priceMinor = _int(j['priceMinor']),
        originalPriceMinor = _intOrNull(j['originalPriceMinor']),
        estimate = _str(j['estimate']);
  final String id;
  final String carrierName;
  final String serviceName;
  final int priceMinor;
  final int? originalPriceMinor;
  final String estimate;
}

class Quote {
  Quote(Json j)
      : id = _str(j['id']),
        currency = _str(j['currency']),
        options = _list(j['options']).map(ShippingOption.new).toList(),
        dutiesNotice = _strOrNull(j['dutiesNotice']),
        message = _strOrNull(j['message']);
  final String id;
  final String currency;
  final List<ShippingOption> options;
  final String? dutiesNotice;
  final String? message;
}

class OrderItem {
  OrderItem(Json j)
      : id = _int(j['id']),
        name = _str(j['name']),
        description = _str(j['description']),
        quantity = _int(j['quantity']),
        totalMinor = _int(j['totalMinor']),
        isFinalSale = j['isFinalSale'] == true,
        returnableQuantity = _int(j['returnableQuantity']);
  final int id;
  final String name;
  final String description;
  final int quantity;
  final int totalMinor;
  final bool isFinalSale;
  final int returnableQuantity;
}

class TrackingEvent {
  TrackingEvent(Json j)
      : description = _str(j['description']),
        location = _strOrNull(j['location']),
        occurredAt = _str(j['occurredAt']);
  final String description;
  final String? location;
  final String occurredAt;
}

class Shipment {
  Shipment(Json j)
      : carrierName = _str(j['carrierName']),
        trackingNumber = _strOrNull(j['trackingNumber']),
        trackingUrl = _strOrNull(j['trackingUrl']),
        status = _str(j['status']),
        events = _list(j['events']).map(TrackingEvent.new).toList();
  final String carrierName;
  final String? trackingNumber;
  final String? trackingUrl;
  final String status;
  final List<TrackingEvent> events;
}

class ReturnSummary {
  ReturnSummary(Json j)
      : id = _int(j['id']),
        number = _str(j['number']),
        status = _str(j['status']),
        refundMinor = _int(j['refundMinor']),
        requestedAt = _str(j['requestedAt']);
  final int id;
  final String number;
  final String status;
  final int refundMinor;
  final String requestedAt;
}

class Order {
  Order(Json j)
      : number = _str(j['number']),
        placedAt = _str(j['placedAt']),
        status = _str(j['status']),
        paymentStatus = _str(j['paymentStatus']),
        currency = _str(j['currency']),
        items = _list(j['items']).map(OrderItem.new).toList(),
        subtotalMinor = _int(j['subtotalMinor']),
        discountMinor = _int(j['discountMinor']),
        shippingMinor = _int(j['shippingMinor']),
        giftCardMinor = _int(j['giftCardMinor']),
        totalMinor = _int(j['totalMinor']),
        refundedMinor = _int(j['refundedMinor']),
        amountDueMinor = _int(j['amountDueMinor']),
        address = _map(j['address']) == null ? null : Address.fromJson(_map(j['address'])!),
        deliveryService = _strOrNull(_map(j['delivery'])?['service']),
        deliveryEstimate = _strOrNull(_map(j['delivery'])?['estimate']),
        dutiesNotice = j['dutiesNotice'] == true,
        timeline = _list(j['timeline']),
        shipments = _list(j['shipments']).map(Shipment.new).toList(),
        returns = _list(j['returns']).map(ReturnSummary.new).toList(),
        canPay = j['canPay'] == true,
        canCancel = j['canCancel'] == true,
        canReturn = j['canReturn'] == true;
  final String number;
  final String placedAt;
  final String status;
  final String paymentStatus;
  final String currency;
  final List<OrderItem> items;
  final int subtotalMinor;
  final int discountMinor;
  final int shippingMinor;
  final int giftCardMinor;
  final int totalMinor;
  final int refundedMinor;
  final int amountDueMinor;
  final Address? address;
  final String? deliveryService;
  final String? deliveryEstimate;
  final bool dutiesNotice;
  final List<Json> timeline;
  final List<Shipment> shipments;
  final List<ReturnSummary> returns;
  final bool canPay;
  final bool canCancel;
  final bool canReturn;
}

class OrderSummary {
  OrderSummary(Json j)
      : number = _str(j['number']),
        placedAt = _str(j['placedAt']),
        status = _str(j['status']),
        paymentStatus = _str(j['paymentStatus']),
        currency = _str(j['currency']),
        totalMinor = _int(j['totalMinor']),
        itemCount = _int(j['itemCount']),
        firstItem = _str(j['firstItem']);
  final String number;
  final String placedAt;
  final String status;
  final String paymentStatus;
  final String currency;
  final int totalMinor;
  final int itemCount;
  final String firstItem;
}

class Customer {
  Customer(Json j)
      : id = _int(j['id']),
        email = _str(j['email']),
        emailVerified = j['emailVerified'] == true,
        firstName = _str(j['firstName']),
        lastName = _str(j['lastName']),
        hasPassword = j['hasPassword'] == true;
  final int id;
  final String email;
  final bool emailVerified;
  final String firstName;
  final String lastName;
  final bool hasPassword;
}

class AppNotification {
  AppNotification(Json j)
      : id = _int(j['id']),
        title = _str(j['title']),
        body = _str(j['body']),
        link = _strOrNull(j['link']),
        read = j['readAt'] != null || j['read'] == true,
        createdAt = _str(j['createdAt']);
  final int id;
  final String title;
  final String body;
  final String? link;
  final bool read;
  final String createdAt;
}

class CurrencyInfo {
  CurrencyInfo(Json j)
      : code = _str(j['code']),
        name = _str(j['name']),
        symbol = _str(j['symbol']);
  final String code;
  final String name;
  final String symbol;
}
