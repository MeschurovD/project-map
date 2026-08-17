import { UserCard } from "@/entities/user";
import { useUserProfile } from "@/features/user-profile";

export function UserProfileWidget() {
  const profile = useUserProfile();

  return <UserCard name={profile.name} />;
}
