# Security Policy

## Overview
Quotation Manager SaaS is engineered with a multi-layered security architecture running natively on Cloudflare:
- **Zero-Trust Network Perimeter:** Direct TLS 1.3 encryption, automatic Cloudflare DDoS mitigation, and Cloudflare WAF protection.
- **Bot & Abuse Protection:** Cloudflare Turnstile CAPTCHA verified at the edge on authentication endpoints.
- **Stateless Session Security:** Cryptographically signed JSON Web Tokens (JWT) using Web Crypto HMAC-SHA256 with 7-day expiration.
- **Strict Role-Based Access Control (RBAC):** Backend verification in Cloudflare Workers on all mutating endpoints (`POST`, `PUT`, `DELETE`).
- **SQL Injection Prevention:** 100% parameterized queries using Cloudflare D1 (SQLite) prepared statements.
- **Credential Storage:** Non-reversible SHA-256 password hashing. Zero plaintext passwords in database or transit.

---

## Supported Versions

Only the current production branch and actively deployed Cloudflare Workers receive security patches:

| Version | Status |
| ------- | ------ |
| 3.x     | :white_check_mark: Actively Supported |
| < 3.0   | :x: End of Life |

---

## Reporting a Vulnerability

If you discover a security vulnerability in Quotation Manager:
1. **Do not create public GitHub issues or discussions.**
2. Send a detailed report describing the vulnerability, proof of concept, and affected endpoints to the repository administrator or via email to your organization's security contact.
3. Vulnerability reports are triaged within 48 hours, and critical patches are deployed immediately across Cloudflare Workers.
