-- 0021 Live chat (module 18): a visitor may leave an email so a staff reply
-- can reach them after they leave the page.
alter table chat_conversations add column visitor_email citext;
create index chat_messages_unread on chat_messages (conversation_id) where read_at is null;
