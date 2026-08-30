# Optional company logo overrides

Autumn Compass ships text monograms by default. You may place logo artwork in
this directory for your own local installation; every other file in the
directory is ignored by Git. Then add the following to the ignored
`apps/web/.env.local` file and restart the Web app:

```dotenv
VITE_ENABLE_LOCAL_COMPANY_LOGOS=true
```

Company names and marks belong to their respective owners. Confirm that you
have permission before redistributing any artwork.
