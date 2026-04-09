import { Users } from "lucide-react";

interface Member {
  name: string;
  role: string;
}

interface Team {
  name: string;
  color: string;
  bgColor: string;
  borderColor: string;
  leader: Member;
  members: Member[];
}

const TEAMS: Team[] = [
  {
    name: "공사팀",
    color: "#2563eb",
    bgColor: "#eff6ff",
    borderColor: "#bfdbfe",
    leader: { name: "홍길동", role: "팀장" },
    members: [
      { name: "김철수", role: "담당자" },
      { name: "이영희", role: "담당자" },
      { name: "박민수", role: "담당자" },
    ],
  },
  {
    name: "공무팀",
    color: "#7c3aed",
    bgColor: "#f5f3ff",
    borderColor: "#ddd6fe",
    leader: { name: "최준혁", role: "팀장" },
    members: [
      { name: "정수빈", role: "담당자" },
      { name: "한지우", role: "담당자" },
    ],
  },
  {
    name: "품질팀",
    color: "#059669",
    bgColor: "#ecfdf5",
    borderColor: "#a7f3d0",
    leader: { name: "강태영", role: "팀장" },
    members: [
      { name: "윤서연", role: "담당자" },
      { name: "송민재", role: "담당자" },
      { name: "임하늘", role: "담당자" },
    ],
  },
  {
    name: "안전팀",
    color: "#dc2626",
    bgColor: "#fef2f2",
    borderColor: "#fecaca",
    leader: { name: "오성호", role: "팀장" },
    members: [
      { name: "배지훈", role: "담당자" },
      { name: "조은비", role: "담당자" },
    ],
  },
  {
    name: "설계팀",
    color: "#d97706",
    bgColor: "#fffbeb",
    borderColor: "#fde68a",
    leader: { name: "신예진", role: "팀장" },
    members: [
      { name: "류현우", role: "담당자" },
      { name: "장소율", role: "담당자" },
      { name: "권도현", role: "담당자" },
    ],
  },
];

function PersonCard({
  name,
  role,
  color,
  isLeader,
}: {
  name: string;
  role: string;
  color: string;
  isLeader?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 bg-white border rounded-xl px-4 py-3 shadow-sm transition-shadow hover:shadow-md"
      style={{ borderColor: isLeader ? color : "#e5e7eb" }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
        style={{ backgroundColor: color }}
      >
        {name.slice(0, 1)}
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground leading-tight">{name}</p>
        <p className="text-xs text-muted-foreground">{role}</p>
      </div>
    </div>
  );
}

export default function OrgChart() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h2 className="text-base font-bold text-foreground">조직도</h2>
        <span className="text-xs text-muted-foreground ml-1">P4-PH4 초순수 현장</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {TEAMS.map((team) => (
          <div
            key={team.name}
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: team.borderColor, backgroundColor: team.bgColor }}
          >
            {/* Team header */}
            <div
              className="px-4 py-2.5 flex items-center gap-2"
              style={{ backgroundColor: team.color }}
            >
              <span className="text-sm font-bold text-white">{team.name}</span>
              <span className="text-xs text-white/70 ml-auto">
                {1 + team.members.length}명
              </span>
            </div>

            <div className="p-4 space-y-3">
              {/* Leader */}
              <PersonCard
                name={team.leader.name}
                role={team.leader.role}
                color={team.color}
                isLeader
              />

              {/* Connector line */}
              <div className="flex justify-center">
                <div className="w-px h-4" style={{ backgroundColor: team.borderColor }} />
              </div>

              {/* Members */}
              <div className="space-y-2 pl-4 border-l-2" style={{ borderColor: team.borderColor }}>
                {team.members.map((m) => (
                  <PersonCard
                    key={m.name}
                    name={m.name}
                    role={m.role}
                    color={team.color}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
