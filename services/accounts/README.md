# Accounts service

Independent Fastify/TypeScript authentication and document-ownership service. It uses PostgreSQL through Drizzle ORM; migrations are versioned in `migrations/`.

```sh
cp .env.example .env
npm install
npm run db:migrate
npm test
npm run dev
```

All authenticated mutations require the `x-csrf-token` header matching the `csrf` cookie. Session and CSRF cookies are issued by login/registration. Verification and reset links use `APP_ORIGIN`, expire after `TOKEN_TTL_MINUTES`, and are delivered through the configured SMTP server. Configure production SMTP credentials only in the environment.

The root development Compose override starts Mailpit. Its captured inbox is available only on the loopback interface at [http://localhost:8025](http://localhost:8025); Mailpit is not part of the production Compose file when the override is omitted.
