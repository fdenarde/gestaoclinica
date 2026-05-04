import { auth, db } from '../firebase';
import { collection, getDocs, query, where, orderBy, writeBatch, doc } from 'firebase/firestore';

/**
 * Executa a migração de pacotes:
 * - Busca todos os pacientes
 * - Para cada paciente, ordena as sessões cronologicamente
 * - Reagrupa as sessões em pacotes de 10 (sessões 1-10 → pacote 1, 11-20 → pacote 2 etc.)
 * - Atualiza o campo packageNumber em cada sessão
 * - Cria (ou atualiza) documentos na coleção "packages" com:
 *    - patientId, number, status (Concluído / Em andamento), startDate, endDate
 */
export async function runPackageMigration(): Promise<{ success: boolean; message: string }> {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, message: 'Usuário não autenticado. Faça login antes de executar a migração.' };
  }

  try {
    const userDocRef = doc(db, 'users', user.uid);

    // 1. Buscar todos os pacientes
    const patientsSnapshot = await getDocs(collection(userDocRef, 'patients'));
    const patients = patientsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // 2. Buscar TODAS as sessões (para evitar múltiplas consultas)
    const allSessionsSnapshot = await getDocs(collection(userDocRef, 'sessions'));
    const allSessions = allSessionsSnapshot.docs.map(d => ({ id: d.id, ...d.data() as any }));

    // 3. Buscar pacotes antigos (se existirem) para limpeza
    const oldPackagesSnapshot = await getDocs(collection(userDocRef, 'packages'));

    const batch = writeBatch(db);
    let operationCount = 0;
    const MAX_BATCH = 400; // Firestore limita a 500, reservamos margem

    const commitIfNeeded = async () => {
      if (operationCount >= MAX_BATCH) {
        await batch.commit();
        operationCount = 0;
      }
    };

    // 4. Deletar pacotes antigos (coleção packages)
    for (const pkgDoc of oldPackagesSnapshot.docs) {
      batch.delete(pkgDoc.ref);
      operationCount++;
      await commitIfNeeded();
    }

    // 5. Para cada paciente, reagrupar sessões
    for (const patient of patients) {
      const patientId = patient.id;
      // Filtrar sessões desse paciente
      let patientSessions = allSessions
        .filter(s => s.patientId === patientId)
        .sort((a: any, b: any) => {
          // Ordenar por data, depois horário
          const dateCompare = a.date.localeCompare(b.date);
          if (dateCompare !== 0) return dateCompare;
          return (a.time || '').localeCompare(b.time || '');
        });

      // Reatribuir packageNumber baseado na ordem cronológica
      const updatedSessions: any[] = [];
      patientSessions.forEach((session: any, index: number) => {
        const newPackageNumber = Math.floor(index / 10) + 1;
        if (session.packageNumber !== newPackageNumber) {
          session.updatedPackageNumber = newPackageNumber; // marca para atualização
          updatedSessions.push(session);
        }
      });

      // Atualizar cada sessão no batch
      for (const session of updatedSessions) {
        const sessionRef = doc(collection(userDocRef, 'sessions'), session.id);
        batch.update(sessionRef, { packageNumber: session.updatedPackageNumber });
        operationCount++;
        await commitIfNeeded();
      }

      // Criar documentos de pacotes (agrupamento)
      // Agrupar sessões por packageNumber
      const sessionMap: Record<number, any[]> = {};
      patientSessions.forEach((s: any) => {
        const pkgNum = s.updatedPackageNumber || s.packageNumber || Math.floor(patientSessions.indexOf(s) / 10) + 1;
        if (!sessionMap[pkgNum]) sessionMap[pkgNum] = [];
        sessionMap[pkgNum].push(s);
      });

      // Para cada pacote, criar/atualizar documento
      for (const [pkgNumStr, sessions] of Object.entries(sessionMap)) {
        const pkgNum = Number(pkgNumStr);
        const sorted = [...sessions].sort((a: any, b: any) => a.date.localeCompare(b.date));
        const startDate = sorted[0]?.date || '';
        const endDate = sorted[sorted.length - 1]?.date || '';
        const status = sorted.length >= 10 ? 'Concluído' : 'Em andamento';

        const pkgRef = doc(collection(userDocRef, 'packages'), `${patientId}_${pkgNum}`);
        batch.set(pkgRef, {
          patientId,
          number: pkgNum,
          startDate,
          endDate,
          status,
          sessionCount: sorted.length,
          createdAt: new Date().toISOString(),
        });
        operationCount++;
        await commitIfNeeded();
      }
    }

    // Commit final
    if (operationCount > 0) {
      await batch.commit();
    }

    return { success: true, message: `Migração concluída! ${patients.length} pacientes processados.` };
  } catch (error: any) {
    console.error('Erro na migração:', error);
    return { success: false, message: `Erro: ${error.message}` };
  }
}
