-- 0012 Media processing: what is needed to store an upload, resize it into
-- several sizes and know when it is ready to show.

alter table product_media
  -- "processing" while sizes are being made (videos take a while), then "ready" or "failed".
  add column status text not null default 'ready' check (status in ('processing', 'ready', 'failed')),
  -- The widths, in pixels, that exist as files: 640 means 640.webp and 640.jpg.
  add column widths integer[] not null default '{}',
  add column original_name text,
  -- Where the untouched upload is kept. It is never served to visitors.
  add column original_path text,
  add column bytes bigint check (bytes > 0),
  add column error text,
  add column created_by bigint references staff (id) on delete set null;

create unique index product_media_path on product_media (path);
create index product_media_processing on product_media (created_at) where status = 'processing';
