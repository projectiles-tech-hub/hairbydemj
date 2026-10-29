# Data model

| Entity | Key details |
| --- | --- |
| Product | Name, description, category, collection, images, video, care guide, hair origin, texture, grade |
| Variant | Length, density, colour, lace type, cap size, SKU, weight and dimensions (for shipping) |
| Price | One price per variant per currency (NGN, USD, GBP, EUR), set by staff |
| Inventory | Stock level per variant, low-stock threshold |
| Customer | Name, email, phone, addresses, preferred currency, marketing consent, loyalty points |
| Cart and order | Items, currency, totals, discounts, gift cards, payment status, shipment status |
| Payment | Provider (Paystack or Stripe), reference, amount, currency, status confirmed by webhook |
| Shipment | Carrier, service, rate, label, tracking number, delivery events |
| Returns | Order items, reason, status, refund |
| Marketing | Discount codes, gift cards, referrals, wishlists, reviews with photos |
| Staff | Name, email, role, permissions, activity log |
