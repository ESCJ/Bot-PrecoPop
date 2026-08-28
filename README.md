# Grupo Vip - Loja Preço Pop! 🤖

Bot de vendas no Telegram com pagamento automático via Mercado Pago.

## Funcionalidades

- Cadastro de clientes com Nome, CPF, Endereço e CEP.
- Publicação de itens pelo administrador (com foto, descrição, preço e estoque).
- Catálogo de itens com botão **Comprar**.
- Fluxo de compra: quantidade e forma de pagamento.
- Pagamento automático via Mercado Pago (Pix, cartão de crédito, cartão de débito ou boleto).
- Webhook do Mercado Pago para confirmação automática de pagamentos.
- Notificação ao administrador e ao grupo de envio após pagamento confirmado.
- Controle de estoque/esgotado: admin marca item como esgotado, todos os clientes são notificados e o item some do catálogo.
- Relançamento de item esgotado pelo admin.

## Tecnologias

- Node.js + TypeScript
- Telegraf (Telegram Bot API)
- Express.js
- SQLite
- Mercado Pago SDK

## Estrutura do Projeto

```
.
├── src/
│   ├── index.ts              # Express + Telegraf + webhooks
│   ├── config.ts             # Variáveis de ambiente
│   ├── db.ts                 # SQLite e migrations
│   ├── bot.ts                # Registro de comandos/cenas
│   ├── handlers/
│   │   ├── admin.ts          # Painel admin, publicar/esgotar/relançar
│   │   ├── customer.ts       # Cadastro, catálogo e compra
│   │   └── webhooks.ts       # Webhook do Mercado Pago
│   └── services/
│       ├── users.ts          # Cadastro de clientes
│       ├── items.ts          # Itens e estoque
│       ├── orders.ts         # Pedidos
│       └── payments.ts       # Integração Mercado Pago
├── railway.json              # Configuração de deploy no Railway
├── Procfile                  # Comando de inicialização
├── .env.example              # Exemplo de variáveis de ambiente
└── README.md
```

## Configuração inicial

1. Crie um bot no Telegram via [@BotFather](https://t.me/BotFather) e obtenha o token.
2. Crie uma conta no [Mercado Pago](https://www.mercadopago.com.br/developers) e obtenha um Access Token de teste/produção.
3. Descubra seu ID do Telegram e o ID do grupo de envio com [@userinfobot](https://t.me/userinfobot) ou [@getidsbot](https://t.me/getidsbot).
4. Copie o arquivo `.env.example` para `.env` e preencha as variáveis:

```bash
cp .env.example .env
```

## Instalação local

```bash
npm install
```

## Execução em desenvolvimento (polling)

Para testar localmente sem webhook HTTPS, deixe `WEBHOOK_URL` vazio no `.env`:

```env
WEBHOOK_URL=
```

```bash
npm run dev
```

## Deploy no Railway

### 1. Criar repositório no GitHub

```bash
# No seu computador (Windows), dentro da pasta BotPrecoPop:
git init
git add .
git commit -m "Primeiro commit"
git branch -M main
git remote add origin https://github.com/seu-usuario/Bot-PrecoPop.git
git push -u origin main
```

### 2. Criar projeto no Railway

1. Acesse [railway.app](https://railway.app) e faça login.
2. Clique em **New Project** → **Deploy from GitHub repo**.
3. Escolha o repositório `Bot-PrecoPop`.
4. O Railway detectará automaticamente o Node.js e usará o `railway.json`.

### 3. Configurar variáveis de ambiente no Railway

No painel do projeto, vá em **Variables** e adicione:

| Variável | Valor |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Token do @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Um segredo qualquer |
| `ADMIN_CHAT_ID` | Seu ID do Telegram |
| `SHIPPING_GROUP_CHAT_ID` | ID do grupo de envio |
| `MERCADO_PAGO_ACCESS_TOKEN` | Access Token do Mercado Pago |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Segredo do webhook |
| `WEBHOOK_URL` | `https://seu-dominio.railway.app/webhook/telegram` |
| `PUBLIC_URL` | `https://seu-dominio.railway.app` |
| `DATABASE_URL` | `/data/bot.db` (recomendado com volume) ou `./data/bot.db` |

> O Railway fornece automaticamente a variável `PORT`.

### 4. Configurar volume para o banco de dados (recomendado)

1. No Railway, vá em **Volumes** do serviço.
2. Adicione um volume montado em `/data`.
3. Use `DATABASE_URL=/data/bot.db` nas variáveis.

### 5. Configurar webhook do Telegram

Após o deploy, o bot configura o webhook automaticamente usando `WEBHOOK_URL`. Você também pode configurar manualmente via API:

```bash
curl -X POST "https://api.telegram.org/bot<SEU_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://seu-dominio.railway.app/webhook/telegram","secret_token":"SEU_SEGREDO"}'
```

### 6. Configurar webhook do Mercado Pago

No painel do Mercado Pago, configure o webhook para:

```
https://seu-dominio.railway.app/webhooks/mercadopago
```

Ative notificações do tipo `payment`.

## Endpoints expostos

- `POST /webhook/telegram` - Webhook do Telegram
- `POST /webhooks/mercadopago` - Webhook do Mercado Pago
- `GET /health` - Health check

## Comandos do Administrador

- `/admin` - Abre o painel administrativo.
- `/novoitem` - Inicia o wizard para publicar um novo item.
- Botões no painel permitem marcar itens como esgotados ou relançá-los.

## Comandos do Cliente

- `/start` - Inicia o cadastro ou exibe o menu principal.
- Botão **Ver itens à venda** - Lista os itens disponíveis.
- Botão **Comprar** em cada item inicia o fluxo de compra.

## Importante

- O bot deve ser adicionado como administrador no grupo de envio (`SHIPPING_GROUP_CHAT_ID`) para conseguir enviar mensagens.
- Em ambiente de teste do Mercado Pago, use contas de teste para simular pagamentos.
- As credenciais do Mercado Pago devem ser mantidas em segurança e nunca commitadas.

## Licença

MIT
