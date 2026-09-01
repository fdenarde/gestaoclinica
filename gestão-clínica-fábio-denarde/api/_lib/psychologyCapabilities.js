const CAPABILITY_RESOURCES = Object.freeze([
  'patients',
  'sessions',
  'services',
  'locations',
  'clinicalNotes',
  'personalAppointments',
  'finance',
  'packages',
  'documents',
  'attachments',
  'reports',
  'settings',
  'onlineBooking',
  'backup',
]);

function resource({ available, view = false, create = false, edit = false, remove = false, exportData = false, load, source, reason }) {
  return {
    available: Boolean(available),
    view: Boolean(available && view),
    create: Boolean(available && create),
    edit: Boolean(available && edit),
    delete: Boolean(available && remove),
    export: Boolean(available && exportData),
    load: load || (available ? 'on-demand' : 'unavailable'),
    source: source || 'none',
    ...(reason ? { reason } : {}),
  };
}

function unavailable(source, reason) {
  return resource({ available: false, source, reason, load: 'unavailable' });
}

/**
 * Returns only coarse-grained UI capabilities. It deliberately omits
 * identities, permission overrides, tokens and clinical data. The resolved
 * server-side access context remains the authorization authority for every
 * request; this object is only a safe UX contract.
 */
export function buildPsychologyCapabilities(runtimeScope) {
  const permissions = new Set(Array.isArray(runtimeScope?.permissions) ? runtimeScope.permissions : []);
  const can = (...keys) => keys.some(key => permissions.has(key));
  const canAnySettingsRead = can('agenda.own.view', 'settings.clinic.manage');

  return {
    schemaVersion: 1,
    context: 'PSICOLOGIA',
    resources: {
      patients: resource({ available: true, view: can('patients.list'), create: can('patients.create'), edit: can('patients.edit'), remove: can('patients.delete'), load: 'bootstrap', source: 'psychology-api' }),
      sessions: resource({ available: true, view: can('agenda.own.view'), load: 'bootstrap', source: 'psychology-api', reason: 'remote-ui-read-only-in-this-stage' }),
      services: resource({ available: true, view: can('agenda.own.view'), edit: can('agenda.edit', 'settings.clinic.manage'), load: 'bootstrap', source: 'psychology-api' }),
      locations: resource({ available: true, view: can('agenda.own.view'), edit: can('agenda.edit', 'settings.clinic.manage'), load: 'bootstrap', source: 'psychology-api' }),
      clinicalNotes: unavailable('psychology-api', 'not-loaded-in-remote-bootstrap'),
      personalAppointments: unavailable('psychology-api', 'not-loaded-in-remote-bootstrap'),
      finance: unavailable('psychology-api', 'not-loaded-in-remote-bootstrap'),
      packages: unavailable('psychology-api', 'not-loaded-in-remote-bootstrap'),
      documents: unavailable('psychology-api', 'not-loaded-in-remote-bootstrap'),
      attachments: unavailable('psychology-api', 'not-loaded-in-remote-bootstrap'),
      reports: unavailable('none', 'no-remote-report-surface'),
      settings: resource({ available: canAnySettingsRead, view: canAnySettingsRead, edit: can('settings.clinic.manage'), load: 'bootstrap', source: 'psychology-api' }),
      onlineBooking: unavailable('public-booking-server', 'authenticated-professional-settings-endpoint-not-available'),
      backup: resource({ available: can('patients.clinical_notes.view'), view: can('patients.clinical_notes.view'), load: 'on-demand', source: 'psychology-api' }),
    },
  };
}

export { CAPABILITY_RESOURCES };
