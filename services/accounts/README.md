# Accounts service

Independent Fastify/TypeScript authentication and document-ownership service. It uses PostgreSQL through Drizzle ORM; migrations are versioned in `migrations/`.

```sh
cp .env.example .env
npm install
npm run db:migrate
npm test
npm run dev
```

All authenticated mutations require the `x-csrf-token` header matching the `csrf` cookie. Session and CSRF cookies are issued by login/registration. Verification and reset token delivery is intentionally represented by `TokenMailer`; connect a production mail provider rather than returning tokens from HTTP endpoints. Configure secrets only in the environment.
