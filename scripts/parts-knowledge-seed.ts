import "dotenv/config";

import { seedStaticPartKnowledge } from "@/src/services/parts-knowledge.service";

const result = await seedStaticPartKnowledge();
console.log(JSON.stringify({
  ok: true,
  message: "Parts knowledge seed completed.",
  ...result,
}, null, 2));
