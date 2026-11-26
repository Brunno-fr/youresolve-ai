<p align="center"><img src="public/brand/youresolve-sidebar.png" alt="Símbolo verde do YouResolve AI" width="84"></p>

# YouResolve AI

**Intelligent Financial Operations** · Proposta de Brunno Augusto para o Desafio de Inovação do Programa de Estágio YouShop 2027.

Quando um pedido é reembolsado e a comissão continua positiva, quem investiga precisa encontrar os lançamentos que explicam a diferença. O YouResolve AI reúne o pedido, a regra acionada e as evidências para que o analista registre sua decisão.

**[Experimentar o protótipo](https://brunno-fr.github.io/youresolve-ai/)** · **[Ler a apresentação em PDF](docs/YouResolve-AI-Pitch.pdf)**

## Experimente em dois minutos

1. Na **Visão geral**, selecione **Investigar** na fila prioritária para abrir um pedido com alerta.
2. Confira os lançamentos e a evidência da regra. Registre uma decisão com justificativa e consulte **Auditoria** para ver o histórico local.
3. Para reproduzir o exemplo do pitch, importe os dois arquivos da pasta [examples](examples/) em **Conciliação** e abra o pedido `YS-DEMO-01`. A venda de R$ 200,00 tem um reembolso integral e uma comissão positiva de R$ 40,00.
4. Para experimentar o teste manual e assistido, use a base de demonstração e abra **Avaliação**. São dez tarefas de classificação.

## O que o protótipo verifica

Na base sintética de 1.285 pedidos, as quatro regras sinalizam 37 pedidos. São 12 diferenças de comissão, 10 reembolsos com comissão positiva, 9 pedidos sem lançamento de pagamento e 6 com pagamentos duplicados. Cada alerta exige interpretação humana.

O motor calcula valores em centavos. O copiloto atual oferece explicações simuladas. Uma futura integração com modelo de linguagem deverá citar os registros de origem e permitir que o analista confira cada afirmação. A aplicação roda no navegador, com dados fictícios e sem conexão com sistemas financeiros da YouShop. O histórico de demonstração fica no armazenamento local do navegador e pode ser apagado.

## Primeiro piloto

Uma pessoa que estava aprendendo o fluxo classificou cinco pedidos por modo. O tempo mediano foi de **32,9 s no manual** e **25,4 s no assistido**, com **5/5 acertos em cada modo**. O teste inicial do autor serviu de calibração e ficou fora desse resultado. Familiaridade, ordem de execução e tamanho da amostra limitam a interpretação.

## Executar localmente

Com Node.js 22 e npm, na raiz do repositório:

```sh
npm ci
npm run dev
```

Abra o endereço mostrado pelo Vite. Use `npm test` para executar os testes ou `npm run build` para verificar o TypeScript e gerar a versão de produção.

O código usa React, TypeScript, Vite e Vitest. As regras estão em [src/domain](src/domain/), o fluxo de avaliação em [src/pages/EvaluationPage.tsx](src/pages/EvaluationPage.tsx) e o formato dos CSVs no [dicionário de dados](docs/DATA_DICTIONARY.md).
