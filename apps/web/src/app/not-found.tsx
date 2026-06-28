import { ErrorState } from "@/components/ui/ErrorState";

export default function NotFound() {
  return (
    <ErrorState
      eyebrow="404"
      title="Page not found"
      message="The page you're looking for doesn't exist or has been moved."
      primaryHref="/"
      primaryLabel="Go home"
      secondaryHref="/marketplace"
      secondaryLabel="Browse marketplace"
    />
  );
}
