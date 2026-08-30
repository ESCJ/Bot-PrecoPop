-- Suspensão de cliente pelo administrador.
--
-- Proposital: NÃO reaproveita `blocked_bot`. Os dois campos parecem iguais mas
-- significam coisas opostas:
--   blocked_bot -> o cliente bloqueou o bot (detectado quando um envio falha)
--   banned_at   -> o administrador suspendeu o cliente
-- Misturar os dois faria uma falha de entrega no broadcast virar uma suspensão,
-- e um cliente suspenso continuar recebendo comunicados.

ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

-- Parcial: só indexa quem está suspenso, que é a minoria consultada.
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned_at) WHERE banned_at IS NOT NULL;
