import "./NotesTableSkeleton.css";

const SKELETON_ROW_COUNT = 6;

export function NotesTableSkeleton() {
  return (
    <table aria-label="Loading notes">
      <thead>
        <tr>
          <th>Patient</th>
          <th>Status</th>
          <th>Assigned reviewer</th>
          <th>Revision</th>
          <th>Updated time</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        {Array.from(
          { length: SKELETON_ROW_COUNT },
          (_, index) => (
            <tr key={index}>
              <td>
                <span className="skeleton-cell" />
              </td>

              <td>
                <span className="skeleton-cell" />
              </td>

              <td>
                <span className="skeleton-cell" />
              </td>

              <td>
                <span className="skeleton-cell" />
              </td>

              <td>
                <span className="skeleton-cell" />
              </td>

              <td>
                <span className="skeleton-cell" />
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}