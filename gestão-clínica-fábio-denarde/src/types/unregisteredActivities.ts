export interface UnregisteredActivityGroup {
  id: string;
  patientId: string;
  patientName: string;
  patientPhotoUrl: string;
  patientPhotoDriveFileId: string;
  packageNumber: number;
  date: string;
  times: string[];
  sessionIds: string[];
  sessionNumbers: number[];
  endAt: string;
  doubleOrReplacement: boolean;
}

export interface UnregisteredActivityResult {
  groups: UnregisteredActivityGroup[];
  monitoringStart: string;
  warning: string;
}
