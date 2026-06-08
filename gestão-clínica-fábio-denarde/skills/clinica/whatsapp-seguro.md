# Skill — Robô WhatsApp Seguro

## Função

Proteger o robô WhatsApp contra envios indevidos, duplicados, fora do horário ou para responsável errado.

## Objetivo

Permitir análise, melhoria e relatório do robô sem risco de constrangimento com pacientes, responsáveis ou atendentes.

## Regras obrigatórias

1. Nunca enviar mensagem real durante análise.
2. Nunca iniciar WhatsApp durante auditoria.
3. Nunca gerar QR Code durante relatório offline.
4. Nunca disparar lembretes sem autorização explícita.
5. Usar modo simulação sempre que possível.
6. Validar data da sessão.
7. Validar horário real da sessão.
8. Validar paciente.
9. Validar responsável.
10. Validar telefone.
11. Validar texto exato da mensagem.
12. Evitar duplicidade de envio.
13. Registrar bloqueios e exclusões.
14. Confirmar se mensagem é de véspera ou do dia.
15. Confirmar período: manhã, tarde ou outro.

## Eventos críticos

- Mensagem de véspera.
- Mensagem do dia.
- Relatório para o próprio responsável do sistema.
- Alerta meia hora antes.
- Bloqueios.
- Exclusões.
- Paciente sem telefone.
- Responsável sem telefone.
- Agendamento cancelado.
- Falta.
- Sessão já realizada.
- Horário alterado.

## Relatório offline obrigatório

Quando solicitado, o relatório deve mostrar exatamente quais mensagens seriam enviadas, sem enviar nada.

Formato recomendado:

```text
**Terça, 09/06/2026**

**Véspera, enviada em 08/06 para sessão de 09/06**

Responsável:
Paciente:
Telefone:
Horário real:
Mensagem:
```

## Prompt padrão para relatório offline

```text
Gere um relatório offline detalhado do robô WhatsApp para o período de [DATA INICIAL] até [DATA FINAL].

Importante:
- Não envie mensagens.
- Não inicialize o WhatsApp.
- Não gere QR Code.
- Use apenas a lógica atual do robô e os dados disponíveis/backup.
- O relatório deve mostrar exatamente quais mensagens seriam enviadas.

Organizar por dia da semana e data, separando em:
1. Mensagens de véspera
2. Mensagens do dia/manhã
3. Mensagens do dia/tarde
4. Bloqueios/exclusões

Para cada mensagem informar:
- Responsável
- Paciente
- Telefone
- Horário real da sessão
- Texto completo da mensagem exatamente como seria enviada

Não usar tabela como formato principal.
Utilizar blocos de leitura fácil.
```

## Proibição absoluta

Nunca substituir simulação por envio real.
Nunca tentar "testar" mandando mensagem real.
Nunca disparar mensagem para responsável sem confirmação explícita.
