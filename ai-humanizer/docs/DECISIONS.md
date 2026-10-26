# Implementation decisions

- React/Vite and Vercel Node functions are the supported runtime. Legacy platform functions, entities, SDK shims, auth screens, and export metadata have been removed.
- Documents and preferences live in browser storage. There is no account system, server document database, queue, or subscription billing.
- The browser runs one server stage at a time. Small, sequential sections preserve context and bound function work. Assembly is lossless rather than another unconstrained whole-document rewrite.
- Auditing uses the original text, extraction coverage, deterministic checks, and a separate model call. Newly introduced facts are review findings. Automated checks are fallible and never verify the original's factual truth.
- Production requires shared Redis request limits, including a global daily stage ceiling. In-memory development limits are not sufficient for serverless instances. Provider billing limits and deployment access controls remain operator responsibilities.
- Prompt schemas and fingerprints protect workflow correctness, not client-state authenticity. Estimated tokens and cost are not a billing ledger.
- Live provider validation requires real credentials supplied outside source control. Automated tests mock provider transport and do not establish live model quality.
