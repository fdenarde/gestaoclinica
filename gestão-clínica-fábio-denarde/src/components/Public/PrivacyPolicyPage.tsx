import { Database, Mail, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { CLINIC_INFO } from '../../constants';
import BrandLogo from '../Common/BrandLogo';

const LAST_UPDATED = '16 de agosto de 2026';

const policyHighlights = [
  {
    title: 'Uso responsável',
    description: 'Os dados são usados apenas para organizar atendimentos, registros e comunicações relacionadas aos serviços da clínica.',
    icon: Database,
  },
  {
    title: 'Sem venda de dados',
    description: 'Não vendemos, alugamos ou comercializamos dados pessoais para terceiros.',
    icon: ShieldCheck,
  },
  {
    title: 'Acesso necessário',
    description: 'O acesso às informações é limitado às pessoas e finalidades necessárias para o atendimento.',
    icon: UserRound,
  },
];

export default function PrivacyPolicyPage() {
  const deletionEmail = `mailto:${CLINIC_INFO.email}?subject=Solicitação de exclusão de dados`;

  return (
    <main className="min-h-screen bg-clinic-bg px-4 py-5 text-clinic-text sm:px-6 sm:py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-5 rounded-3xl bg-clinic-header px-5 py-5 shadow-clinic sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <BrandLogo
            variant="horizontal"
            theme="health-balance"
            name="Fábio Denarde"
            subtitle="Gestão Clínica e Acompanhamento"
          />
          <span className="inline-flex w-fit items-center rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold text-white/90">
            Informação pública · sem login
          </span>
        </header>

        <section className="rounded-3xl border border-clinic-border bg-clinic-surface px-5 py-8 shadow-clinic sm:px-10 sm:py-12">
          <div className="flex max-w-3xl flex-col gap-5">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-status-green-bg text-status-green-text">
              <ShieldCheck size={25} aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-clinic-primary">Transparência e cuidado</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-clinic-text sm:text-5xl">Política de privacidade</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-clinic-text-muted sm:text-lg">
                Esta página explica, de forma simples, como a Gestão Clínica utiliza informações para apoiar a organização e a comunicação dos atendimentos.
              </p>
            </div>
            <p className="text-sm font-semibold text-clinic-text-faint">Última atualização: {LAST_UPDATED}</p>
          </div>
        </section>

        <section aria-label="Resumo da política" className="grid gap-4 md:grid-cols-3">
          {policyHighlights.map(({ title, description, icon: Icon }) => (
            <article key={title} className="rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-clinic-bg text-clinic-primary">
                <Icon size={20} aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-lg font-black text-clinic-text">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-clinic-text-muted">{description}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 rounded-3xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic sm:p-8 lg:grid-cols-[1fr_0.8fr] lg:p-10">
          <div className="space-y-7">
            <div>
              <h2 className="text-2xl font-black text-clinic-text">Como as informações são utilizadas</h2>
              <p className="mt-3 text-sm leading-7 text-clinic-text-muted sm:text-base">
                As informações podem ser utilizadas para organizar a rotina da clínica, manter registros necessários ao atendimento e facilitar comunicações relacionadas a consultas e serviços solicitados.
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-black text-clinic-text">Proteção e acesso</h2>
              <p className="mt-3 text-sm leading-7 text-clinic-text-muted sm:text-base">
                Buscamos manter as informações protegidas e acessíveis somente dentro das finalidades legítimas do atendimento. Não usamos os dados para venda ou publicidade de terceiros.
              </p>
            </div>
          </div>

          <aside className="flex flex-col justify-between gap-6 rounded-2xl bg-clinic-bg p-5 sm:p-6">
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-status-orange-bg text-status-orange-text">
                <Trash2 size={21} aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-xl font-black text-clinic-text">Solicite a exclusão</h2>
              <p className="mt-2 text-sm leading-6 text-clinic-text-muted">
                Você pode solicitar a exclusão de dados pelo contato da clínica. A equipe poderá pedir uma confirmação de identidade antes de atender ao pedido.
              </p>
            </div>
            <a
              href={deletionEmail}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-sm font-black text-white transition hover:bg-clinic-primary-hover focus:outline-none focus:ring-2 focus:ring-clinic-primary/40 focus:ring-offset-2"
            >
              <Mail size={17} aria-hidden="true" />
              Falar com a clínica
            </a>
          </aside>
        </section>

        <footer className="px-2 pb-2 text-center text-xs font-semibold text-clinic-text-faint">
          {CLINIC_INFO.name} · {CLINIC_INFO.specialty} · {CLINIC_INFO.email}
        </footer>
      </div>
    </main>
  );
}
