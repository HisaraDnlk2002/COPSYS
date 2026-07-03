import { useState } from "react";
import { Button, InputField, Card, StatCard, Table, Badge, Modal, Loader } from "../../components";

// Temporary page, just for visually checking the component set during
// development. Not part of the real app navigation — safe to delete
// once the real feature pages are built and you've confirmed everything
// looks right.
export function ComponentPreviewPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [textValue, setTextValue] = useState("");

  const columns = [
    { key: "day", label: "Day" },
    { key: "shift", label: "Shift Timing" },
    { key: "department", label: "Assign Department" },
    {
      key: "status",
      label: "Status",
      render: (row) => <Badge status={row.status} />,
    },
  ];

  const rows = [
    { id: 1, day: "Monday", shift: "08:00 - 16:00", department: "Traffic Control", status: "confirmed" },
    { id: 2, day: "Friday", shift: "08:00 - 16:00", department: "Traffic Control", status: "pending" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "32px", maxWidth: 900 }}>
      <section>
        <h2>Buttons</h2>
        <div style={{ display: "flex", gap: 12 }}>
          <Button variant="primary">Register complaint</Button>
          <Button variant="outline">Apply Leave</Button>
          <Button variant="ghost">Discard Draft</Button>
          <Button variant="danger">Disable Account</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </section>

      <section>
        <h2>Stat Cards</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          <StatCard label="Today's Duty" value="Administration" caption="shift 6.00 -18.00" />
          <StatCard label="Leave Status" value="12 Days" caption="Available Balance" />
          <StatCard label="Assigned Complaints" value="05 Cases" caption="Active Investigations" />
          <StatCard label="Next Shift" value="Tomorrow" caption="shift 6.00 -18.00" />
        </div>
      </section>

      <section>
        <h2>Panel Card + Table</h2>
        <Card variant="panel">
          <h3 style={{ marginBottom: 16 }}>Weekly Duty Schedule</h3>
          <Table columns={columns} data={rows} />
        </Card>
      </section>

      <section>
        <h2>Badges</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <Badge status="confirmed" />
          <Badge status="pending" />
          <Badge status="approved" />
          <Badge status="rejected" />
          <Badge status="active" />
          <Badge status="disabled" />
        </div>
      </section>

      <section>
        <h2>Input Fields</h2>
        <div style={{ maxWidth: 400 }}>
          <InputField label="Full Name" value={textValue} onChange={(e) => setTextValue(e.target.value)} placeholder="e.g. Kasun Perera" required />
          <InputField
            label="Department"
            type="select"
            value=""
            onChange={() => {}}
            options={[
              { value: "traffic", label: "Traffic Control" },
              { value: "crime", label: "Crime" },
            ]}
          />
          <InputField label="Detailed Description" type="textarea" value="" onChange={() => {}} placeholder="Complete Permanent Address" />
        </div>
      </section>

      <section>
        <h2>Modal + Loader</h2>
        <Button variant="outline" onClick={() => setModalOpen(true)}>
          Open Modal
        </Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Disable this account?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setModalOpen(false)}>
                Disable
              </Button>
            </>
          }
        >
          <p>This officer will no longer be able to log in until reactivated.</p>
        </Modal>

        <div style={{ marginTop: 24 }}>
          <Loader label="Loading personnel…" />
        </div>
      </section>
    </div>
  );
}
