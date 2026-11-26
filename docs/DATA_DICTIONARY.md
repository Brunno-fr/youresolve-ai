# Dicionário de dados e importação CSV

## Formato aceito

São necessários dois arquivos com extensão `.csv`, codificados em **UTF-8**, separados por vírgulas. O BOM é opcional. O parser aceita finais de linha CRLF, LF ou CR e campos entre aspas; uma aspa dentro de um campo é representada por `""`. Vírgulas e quebras de linha dentro do texto exigem aspas.

Cada arquivo aceita até **1 MiB (1.048.576 bytes UTF-8)** e **10.000 registros**, sem contar o cabeçalho. Linhas físicas vazias são ignoradas; uma linha de células vazias delimitadas continua sendo um registro e deve satisfazer o contrato. Espaços externos das células são removidos na importação.

Os cabeçalhos devem corresponder exatamente às colunas e à ordem abaixo. Aspas malformadas, colunas extras/ausentes, NUL e UTF-8 inválido são rejeitados. Datas precisam existir no calendário gregoriano, no formato `YYYY-MM-DD`, com ano de `0001` a `9999`.

## Pedidos

```csv
id,date,grossCents,status,creatorId,commissionRateBps
YS-DEMO-01,2026-11-20,20000,refunded,CREATOR-01,2000
YS-DEMO-02,2026-11-20,30000,approved,CREATOR-02,1500
```

| Coluna | Contrato |
|---|---|
| `id` | Texto não vazio, único no arquivo, sem caracteres de controle |
| `date` | Data civil válida, `YYYY-MM-DD` |
| `grossCents` | Inteiro não negativo em centavos de BRL |
| `status` | `approved` ou `refunded` |
| `creatorId` | Texto não vazio, sem caracteres de controle; pode aparecer em vários pedidos |
| `commissionRateBps` | Inteiro entre 0 e 10.000 pontos-base; `2000` representa 20% |

O arquivo de pedidos exige pelo menos um registro.

## Lançamentos

```csv
id,orderId,kind,amountCents,at
L-01,YS-DEMO-01,payment,20000,2026-11-20
L-02,YS-DEMO-01,commission,4000,2026-11-20
L-03,YS-DEMO-01,refund,20000,2026-11-21
L-04,YS-DEMO-02,payment,30000,2026-11-20
L-05,YS-DEMO-02,commission,4500,2026-11-20
```

| Coluna | Contrato |
|---|---|
| `id` | Texto não vazio, único no arquivo, sem caracteres de controle |
| `orderId` | ID existente no CSV de pedidos; referências órfãs são rejeitadas |
| `kind` | `payment`, `commission` ou `refund` |
| `amountCents` | Inteiro não negativo em centavos de BRL |
| `at` | Data civil válida do lançamento, `YYYY-MM-DD` |

O arquivo de lançamentos pode conter **apenas o cabeçalho**. Isso permite investigar pedidos sem registros de pagamento. Um arquivo totalmente vazio é inválido.

## Unidades, duplicidade e limites financeiros

`20000` centavos correspondem a **R$ 200,00**. Campos inteiros aceitam somente dígitos decimais: rejeitam sinais, frações, notação exponencial e valores acima de `9.007.199.254.740.991`. As somas de lançamentos por pedido e tipo também devem caber nesse limite.

A comissão esperada é calculada com produto inteiro exato e arredondamento de meio centavo para cima. IDs de pedidos ou lançamentos repetidos invalidam a importação. Eventos `payment` com IDs distintos para o mesmo pedido são aceitos e geram a categoria de duplicação para investigação.

O motor mantém quatro categorias de alerta. **Não compara o valor pago com o valor do pedido**, não verifica saldos e não modela reembolsos parciais, tributos, múltiplas moedas ou políticas completas de estorno. Datas dos eventos não comprovam quando uma integração foi processada.

## Decisões e gráficos

`CaseStatus` aceita `open`, `in_review` e `resolved`. Cada evento de auditoria contém `id`, `caseId`, `action`, `status`, `at`, `actor` e `note`. `status` é opcional no contrato para compatibilidade com histórico legado, mas novas decisões o preenchem. `at` usa timestamp ISO UTC, diferente das datas civis dos CSVs.

Resolver exige nota de pelo menos 12 caracteres após remover espaços nas bordas; toda nota aceita até 4.000 caracteres. Os gráficos usam dias UTC e posicionam as transições conforme a auditoria. As datas de criação dos alertas derivam dos pedidos nesta demonstração.

## Privacidade e exportação

Use somente dados fictícios. CSVs importados e decisões sobre eles não são persistidos nem enviados à rede. A auditoria exportada usa UTF-8 com BOM, células entre aspas e CRLF; aspas internas são duplicadas. Conteúdo que possa iniciar fórmula (`=`, `+`, `-`, `@`, inclusive após espaços/controles) recebe prefixo textual de apóstrofo. A proteção não substitui a revisão ao abrir arquivos em planilhas.