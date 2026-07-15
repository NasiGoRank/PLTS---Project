# Kehua authentication

Login page: https://energy.kehua.com/sellerLogin

Credentials must never be stored in this file. Configure them as server-side
environment variables instead:

```text
KEHUA_USERNAME
KEHUA_PASSWORD
```

The backend validates the current authorization before each scrape. When it has
expired, the backend encrypts the password and signs the login request using the
same protocol as Kehua's web client, then keeps the replacement token in memory
for the current scrape.
