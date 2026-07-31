import type { PatientInformation, SessionInformation, } from "../../../domain/noteDetail";

interface PatientSessionCardProps {
  patient: PatientInformation;
  session: SessionInformation;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

export function PatientSessionCard({
  patient,
  session,
}: PatientSessionCardProps) {
  return (
    <section
      className="note-detail-card"
      aria-labelledby="patient-session-heading"
    >
      <h2 id="patient-session-heading">
        Patient and session
      </h2>

      <dl className="patient-session-grid">
        <div>
          <dt>Patient</dt>
          <dd>{patient.displayName}</dd>
        </div>

        <div>
          <dt>Medical record number</dt>
          <dd>{patient.medicalRecordNumber}</dd>
        </div>

        <div>
          <dt>Date of birth</dt>
          <dd>{patient.dateOfBirth}</dd>
        </div>

        <div>
          <dt>Clinician</dt>
          <dd>{session.clinician.displayName}</dd>
        </div>

        <div>
          <dt>Session ID</dt>
          <dd>{session.id}</dd>
        </div>

        <div>
          <dt>Session started</dt>
          <dd>{formatDateTime(session.startedAt)}</dd>
        </div>

        <div>
          <dt>Session ended</dt>
          <dd>{formatDateTime(session.endedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}