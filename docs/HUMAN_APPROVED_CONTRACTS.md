# M0 Human-Approved Behavioral Contracts

**Authority status:** `HUMAN_APPROVED`  
**Approved before core hackathon implementation.**

These are the binding M0 meanings. Models may propose alternatives, but may not silently change these rules.

## H0-1 — Archived account reactivation

An archived account cannot reactivate itself through any user-controlled flow. This includes direct reactivation, password recovery, password reset, email verification, session refresh, or similar recovery mechanisms. Only an authorized administrator may restore an archived account.

## H0-2 — Tenant-scoped export

A user may export only records belonging to the tenant they are currently accessing and for which they are authorized. Visibility, ownership by the same user, organization membership, sharing status, or elevated tenant-level role must not allow records from another tenant to appear in the export unless an explicit cross-tenant permission exists.

## H0-3 — Refund approval by role

Only a user who currently holds the `billing_admin` role may approve and cause a monetary refund to be issued. Other roles may inspect or manage refund requests only to the extent explicitly permitted, but they may not gain refund-approval authority through request ownership, refund amount, cached permissions, an old session, or a previously held role.

## H0-4 — Subscription feature entitlement

Access to Feature X requires both a currently active subscription and an explicit, current Feature X entitlement. Plan tier, trial status, previously cached entitlement, previously held entitlement, or prior successful access must not substitute for the current entitlement state unless an explicit policy says otherwise.

## H0-5 — Refund eligibility

A purchase is refundable only within 14 days, when the purchased service has not been consumed, and while no chargeback dispute is open.
