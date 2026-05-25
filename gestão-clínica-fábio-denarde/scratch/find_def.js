import fs from 'fs';

const filePath = 'd:/Backup Projeto Clinica completo/gestão-clínica-fábio-denarde/src/components/Patients.tsx';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
    if (line.includes('patientSessions') || line.includes('realizedSessionsChronological')) {
        console.log(`Line ${index + 1}: ${line.trim()}`);
    }
});
