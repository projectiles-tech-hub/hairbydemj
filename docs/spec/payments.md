# Payments and currencies

- **Naira (NGN):** Paystack, with card (Visa, Mastercard, Verve), bank transfer and USSD.
- **USD, GBP, EUR:** Stripe, with cards, Apple Pay and Google Pay.
- **Routing:** the checkout picks the provider automatically from the order currency.
- **Confirmation:** an order is marked paid only after the provider's webhook confirms the charge, never from the browser alone.
- **Pricing:** staff set prices per currency in the admin; automatic conversion from a base price is available as an option.
- **Refunds:** issued from the admin dashboard through the original provider.
- **Integration:** both providers' REST APIs are called directly; no SDKs.
