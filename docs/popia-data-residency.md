# POPIA & data residency position

Summary of the position recorded in the main README (which is authoritative):

- **Region:** the Supabase project is created in **eu-west-1** (Ireland), so
  stored records reside outside South Africa.
- **No personal information is stored.** Observer labels are constrained
  pseudonymous codes (max 12 characters, no spaces; real names are rejected
  by validation), the location is a fixed text label, and events carry no
  per-vehicle or per-driver identifiers. The dataset therefore contains no
  personal information as defined by POPIA, and the cross-border transfer
  conditions of **POPIA s72** are not triggered.
- **Revisit trigger:** if personal information of any kind is ever added to
  the schema or the app, this position must be revisited immediately — s72
  safeguards (or an in-country hosting region) and the rest of POPIA would
  then apply.
- Any off-system mapping between observer codes and real people must be kept
  outside this system, with its own owner responsible for retention and
  deletion.
