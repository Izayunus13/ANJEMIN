# Marketplace website payments (simulation)

New checkout orders use website payments: checkout -> pending payment -> held funds -> seller reports handover -> buyer confirms receipt -> seller wallet credit and platform commission.

- All new payments currently require PAYMENT_MODE=SIMULATION and a non-production environment. No money is collected or transferred, and no real bank/e-wallet transfer is implemented.
- Only the buyer can simulate payment and confirm completion. Only the seller can report handover. The old seller-completion endpoint cannot bypass this flow.
- The platform fee is snapshotted at checkout: 3%, capped at Rp20,000. It is recognized once, when the buyer releases funds.
- Seller wallet credits and commission are created in the same SQLite transaction as order completion. Repeated confirmations do not double-credit.
- Cancellation before handover cancels an unpaid invoice or records a simulated refund for held funds. Cancellation after handover is blocked for review.
- Previously recorded COD orders retain their original history. A buyer can convert an active old order using the website payment button.
- Frozen accounts cannot use protected payment actions. Release is blocked while the seller account is frozen.
- Live marketplace collection, custody, refund handling, disputes, and bank payouts require a separately integrated provider and are not enabled by this simulation.

## Seller withdrawal simulation

Seller views include Tarik Saldo, bank/e-wallet input, repeated destination input, and an explicit review/confirmation step. A confirmed simulation reduces available sale balance once and records status SIMULATED. Held funds are excluded. Request keys prevent repeated clicks/retries from debiting twice; concurrent requests are checked in one transaction.

Only the owner can view masked withdrawal history. Full destination numbers are used transiently for validation/fingerprinting and are not stored in the database. Account names are user supplied, not verified by a financial provider. Real collection and payouts remain disabled.
