// Copia os arquivos .sql de migration para o diretório compilado.
// O `tsc` só emite JavaScript, então sem este passo o migrator não encontra
// as migrations quando o app roda a partir de `dist/`.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const from = join("src", "infra", "db", "migrations");
const to = join("dist", "infra", "db", "migrations");

if (!existsSync(from)) {
  console.error(`[copy-migrations] Diretório de origem não encontrado: ${from}`);
  process.exit(1);
}

mkdirSync(to, { recursive: true });

const files = readdirSync(from).filter((file) => file.endsWith(".sql"));
for (const file of files) {
  cpSync(join(from, file), join(to, file));
}

console.log(`[copy-migrations] ${files.length} migration(s) copiada(s) para ${to}`);
