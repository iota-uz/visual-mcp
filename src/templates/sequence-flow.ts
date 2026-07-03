/**
 * sequence-flow template (PLAN.md section 10).
 *
 * D2 source using D2's `shape: sequence_diagram` container to describe a
 * request/response flow between actors. Rendered the same way as
 * architecture-overview: D2 -> SVG -> embed or export (PLAN.md 3.2 / 8.3).
 */

import type { Template } from "../types.js";

const exampleCode = `# Sequence flow: user login with 2FA challenge
# shape: sequence_diagram switches D2 into sequence-diagram layout mode,
# where top-level actors become lifelines and "->"/"->>"/dashed "-->" edges
# become ordered messages read top to bottom.

shape: sequence_diagram

Client: User's browser
Gateway: API Gateway
Auth: Auth Service
DB: Postgres

Client -> Gateway: POST /login {email, password}
Gateway -> Auth: verify credentials
Auth -> DB: SELECT user WHERE email = ?
DB -> Auth: user row
Auth -> Auth: check password hash

Auth -> Gateway: credentials valid, 2FA required
Gateway -> Client: 200 {status: "2fa_required"}

Client -> Gateway: POST /login/2fa {code}
Gateway -> Auth: verify 2FA code
Auth -> DB: SELECT active_challenge WHERE user_id = ?
DB -> Auth: challenge row

Auth -> Auth: validate code + expiry

Auth -> Gateway: issue session token
Gateway -> DB: INSERT INTO sessions
Gateway -> Client: 200 {token, expires_at}
`;

export const sequenceFlowTemplate: Template = {
  id: "sequence-flow",
  name: "Sequence Flow",
  kind: "diagram",
  description:
    "Actor-to-actor sequence diagram (D2 sequence_diagram shape) for " +
    "request/response flows such as auth, checkout or webhook delivery. " +
    "Messages render top-to-bottom in call order.",
  expectedInputs: {
    title: "string — flow title, e.g. 'User login with 2FA challenge'",
    actors: ["string — actor/lifeline name, e.g. 'Client' | 'Auth Service'"],
    messages: [
      {
        from: "string — sending actor",
        to: "string — receiving actor",
        label: "string — message label, e.g. 'POST /login {email, password}'",
      },
    ],
  },
  exampleCode,
};
