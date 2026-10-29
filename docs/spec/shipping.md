# Shipping and delivery

Delivery fees are calculated the way large international stores do it: live
carrier rates at checkout.

1. The cart totals the weight and package size of the items.
2. The API requests live rates directly from each carrier's API (DHL, UPS,
   FedEx) for the customer's address; local Nigerian delivery uses rates set by
   staff in the admin.
3. The customer picks a service, such as express or standard, each shown with
   its price and delivery estimate.
4. After payment, the shipping label and tracking number are created
   automatically and sent to the customer.

**Duties and taxes:** international duties and taxes are paid by the receiver
on delivery, not by hairbydemj (owner's decision, 2026-10-29). Checkout and the
shipping information page must tell international customers this clearly.

**Note:** FedEx requires its labels to pass a certification check before real
shipments.
