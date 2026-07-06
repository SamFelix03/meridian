import { useNavigate } from "react-router-dom";
import { ROLES } from "../lib/roles";
import { Logo } from "./Logo";

function RoleCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="choice-card">
      <div className="choice-card__icon">{icon}</div>
      <span className="choice-card__title">{title}</span>
      <span className="choice-card__desc">{description}</span>
    </button>
  );
}

export function RoleChooser() {
  const navigate = useNavigate();

  return (
    <div className="landing-hero">
      <div className="landing-hero__content">
        <Logo to={null} size="landing" />

        <h1 className="landing-hero__title">
          Privacy-native invoice financing on Canton
        </h1>
        <p className="landing-hero__subtitle">
          Select your organization role to access the Meridian portal. Each persona has an
          isolated view of on-ledger contracts and off-ledger indexers.
        </p>

        <div className="landing-hero__cards">
          {ROLES.map((role) => {
            const Icon = role.icon;
            return (
              <RoleCard
                key={role.id}
                icon={<Icon className="size-6" />}
                title={role.title}
                description={role.description}
                onClick={() => navigate(role.homePath)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
