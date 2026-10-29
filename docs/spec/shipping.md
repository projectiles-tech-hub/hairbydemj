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

**Duties and taxes:** international customers are told whether duties are paid
at checkout or on delivery (decision pending — see `docs/TASKS.md`).

**Note:** FedEx requires its labels to pass a certification check before real
shipments.
