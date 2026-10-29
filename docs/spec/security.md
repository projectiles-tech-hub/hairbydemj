# Security, backups and long-term maintenance

- HTTPS everywhere, with certificates renewed automatically.
- Card details never touch our server; Paystack and Stripe handle them (PCI DSS).
- Staff roles limit who can change prices, refund orders or export customer data.
- Daily encrypted database and image backups copied to a free Google Drive account, with a restore test every month.
- Long-term-support versions only (Ubuntu LTS, Node.js LTS, PostgreSQL), each with years of security updates.
- Automatic security updates on the server.
- Free uptime checks through GitHub Actions that email the owner if the site goes down.
- Very few dependencies: with no frameworks and no paid services, fewer things can break, change their prices or shut down.
- A plain-English operations guide in the repository, so any developer can take over maintenance.
- Privacy policy and cookie notice covering GDPR (UK/EU) and the Nigeria Data Protection Act (NDPA).
- Secret keys kept in server environment settings, never in the code.
- Sign-in, checkout and payment code receive the most testing; an independent security review is recommended before launch.
