# Skill — Pacientes e Prontuário

## Função

Proteger dados cadastrais, histórico, observações e informações clínicas dos pacientes.

## Objetivo

Garantir integridade, privacidade e consistência dos dados dos pacientes.

## Dados sensíveis

- Nome do paciente.
- Responsável.
- Telefone.
- Histórico de atendimentos.
- Observações.
- Pacotes.
- Pagamentos.
- Agenda.
- Sessões.
- Relatórios.

## Regras obrigatórias

1. Não apagar paciente sem confirmação.
2. Não apagar histórico.
3. Não apagar observações.
4. Não sobrescrever telefone.
5. Não sobrescrever responsável.
6. Não expor dados sensíveis em logs desnecessários.
7. Não misturar dados de pacientes.
8. Não duplicar paciente sem validação.
9. Não alterar vínculo com agenda.
10. Não alterar vínculo com pagamentos sem auditoria.

## Melhorias permitidas

- Melhorar tela de detalhes.
- Melhorar organização das informações.
- Criar seções visuais.
- Melhorar botões.
- Melhorar anotações gerais.
- Melhorar histórico.
- Adicionar alertas visuais.
- Adicionar filtros.
- Melhorar busca.

## Testes obrigatórios

- Abrir cadastro.
- Editar dados simples.
- Ver detalhes.
- Ver histórico.
- Inserir observação.
- Conferir agenda do paciente.
- Conferir pagamentos.
- Conferir sessões.
- Conferir responsável.
