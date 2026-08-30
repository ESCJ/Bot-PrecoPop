-- Converte para BIGINT todas as colunas que guardam id de usuário do Telegram.
--
-- As tabelas users, items e orders foram criadas pelo código legado com
-- INTEGER. Como a migration 001 usa CREATE TABLE IF NOT EXISTS, ela nunca
-- corrigiu o tipo em bancos que já existiam: o schema declarado dizia BIGINT,
-- mas a coluna real continuou INTEGER.
--
-- Contas criadas recentemente no Telegram já passam de 2^31 (2.147.483.647),
-- entao qualquer /start desses usuarios estourava com
-- "value ... is out of range for type integer" e derrubava o fluxo inteiro.
--
-- O bloco abaixo e idempotente e so toca no que ainda estiver como integer,
-- preservando os dados. Bancos criados do zero ja estao corretos e sao no-op.

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (
      VALUES
        ('users',             'id'),
        ('items',             'created_by'),
        ('orders',            'user_id'),
        ('carts',             'user_id'),
        ('coupons',           'created_by'),
        ('broadcasts',        'created_by'),
        ('broadcast_targets', 'user_id')
    ) AS t(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = target.table_name
         AND column_name  = target.column_name
         AND data_type    = 'integer'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE BIGINT',
        target.table_name,
        target.column_name
      );
      RAISE NOTICE 'Coluna %.% convertida para BIGINT', target.table_name, target.column_name;
    END IF;
  END LOOP;
END
$$;
