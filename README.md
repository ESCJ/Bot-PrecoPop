# Grupo Vip - Loja Preço Pop! 🤖

Bot de vendas profissional no Telegram com pagamento automático via Mercado Pago.

## Funcionalidades

### Para clientes
- Cadastro completo com Nome, CPF, Endereço e CEP (com validação).
- Edição de dados cadastrais.
- Catálogo de itens com fotos, descrição, preço e estoque.
- Carrinho de compra: escolha de quantidade e forma de pagamento.
- Pagamento automático via Mercado Pago (Pix, cartão de crédito, cartão de débito ou boleto).
- Histórico de pedidos.
- Notificações de pagamento confirmado e envio.

### Para administrador
- Painel administrativo com `/admin`.
- Publicação de itens com foto, descrição, preço e estoque.
- Edição e exclusão de itens.
- Marcar item como esgotado (notifica todos os clientes e oculta do catálogo).
- Relançamento de item esgotado.
- Relatório de vendas.
- Marcar pedido como enviado.
- Notificações automáticas de vendas para admin e grupo de envio.

### Segurança e robustez
- Validação de assinatura dos webhooks do Mercado Pago.
- Autenticação de webhooks do Telegram com secret token.
- Banco de dados PostgreSQL em produção (ou SQLite para testes locais).
- Dados sensíveis nunca são commitados no repositório.

## Tecnologias

- Node.js 20 + TypeScript
- Telegraf (Telegram Bot API)
- Express.js
- PostgreSQL / SQLite
- Mercado Pago SDK
- Docker (opcional)

## Estrutura do Projeto

```
.
├── src/
│   ├── index.ts              # Express + Telegraf + webhooks
│   ├── config.ts             # Variáveis de ambiente validadas
│   ├── db.ts                 # Adapter PostgreSQL/SQLite + migrations
│   ├── bot.ts                # Registro de comandos e cenas
│   ├── handlers/
│   │   ├── admin.ts          # Painel admin completo
│   │   ├── customer.ts       # Cadastro, catálogo, compra, pedidos
│   │   └── webhooks.ts       # Webhook do Mercado Pago com validação
│   └── services/
│       ├── users.ts          # Cadastro e edição de clientes
│       ├── items.ts          # CRUD de itens e estoque
│       ├── orders.ts         # Pedidos e relatórios
│       └── payments.ts       # Integração Mercado Pago
├── railway.json              # Configuração de deploy no Railway
├── Dockerfile                # Imagem Docker opcional
├── Procfile                  # Comando de inicialização
├── .env.example              # Exemplo de variáveis de ambiente
└── README.md
```

## Configuração inicial

1. Crie um bot no Telegram via [@BotFather](https://t.me/BotFather) e obtenha o token.
2. Crie uma conta no [Mercado Pago](https://www.mercadopago.com.br/developers) e obtenha um Access Token.
3. Descubra seu ID do Telegram e o ID do grupo de envio com [@userinfobot](https://t.me/userinfobot) e [@getidsbot](https://t.me/getidsbot).
4. Copie o arquivo `.env.example` para `.env` e preencha as variáveis.

## Instalação local

```bash
npm install
```

## Execução em desenvolvimento

Deixe `WEBHOOK_URL=` vazio no `.env` para usar polling:

```env
WEBHOOK_URL=
PUBLIC_URL=http://localhost:3000
DATABASE_URL=./data/bot.db
```

```bash
npm run dev
```

## Deploy no Railway

### 1. Banco de dados PostgreSQL (recomendado)

1. No Railway, clique em **New** → **Database** → **PostgreSQL**
2. Copie a variável `DATABASE_URL` do PostgreSQL
3. Cole essa URL nas variáveis do serviço do bot

### 2. Variáveis de ambiente

No Railway, configure:

| Variável | Valor |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Token do @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Apenas letras e números |
| `ADMIN_CHAT_ID` | Seu ID do Telegram |
| `SHIPPING_GROUP_CHAT_ID` | ID do grupo de envio |
| `MERCADO_PAGO_ACCESS_TOKEN` | Access Token do Mercado Pago |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Segredo gerado pelo Mercado Pago |
| `WEBHOOK_URL` | `https://seu-dominio.up.railway.app` (ou vazio para polling) |
| `PUBLIC_URL` | `https://seu-dominio.up.railway.app` |
| `DATABASE_URL` | URL do PostgreSQL ou `./data/bot.db` |

> Não crie a variável `PORT` manualmente. O Railway define automaticamente.

### 3. Webhook do Mercado Pago

No painel do Mercado Pago:

```
https://seu-dominio.up.railway.app/webhooks/mercadopago
```

Selecione o evento **payment**. Ao salvar, o Mercado Pago gera uma assinatura secreta. Cole essa assinatura na variável `MERCADO_PAGO_WEBHOOK_SECRET` do Railway.

### 4. Webhook do Telegram

Se estiver usando webhook, o bot configura automaticamente. Para configurar manualmente:

```bash
curl -X POST "https://api.telegram.org/bot<SEU_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://seu-dominio.up.railway.app/webhook/telegram","secret_token":"SEU_SEGREDO"}'
```

## Comandos

### Cliente
- `/start` - Cadastro ou menu principal
- Botão **Ver itens à venda** - Catálogo
- Botão **Meus pedidos** - Histórico
- Botão **Editar meus dados** - Atualizar cadastro

### Admin
- `/admin` - Painel administrativo
- No painel: Novo item, Gerenciar itens, Relatório de vendas

## Endpoints

- `POST /webhook/telegram` - Webhook do Telegram
- `POST /webhooks/mercadopago` - Webhook do Mercado Pago
- `GET /health` - Health check

## Importante

- O bot deve ser adicionado como administrador no grupo de envio.
- Use contas de teste do Mercado Pago para simular pagamentos antes de ir para produção.
- Nunca commit tokens ou arquivos `.env`.

## Licença

MIT
