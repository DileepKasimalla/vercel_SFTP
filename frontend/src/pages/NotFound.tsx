import { Link } from "react-router-dom";
import { Brand } from "../components/ui";

export default function NotFound() {
  return (
    <div className="page page--centered">
      <div className="card card--narrow">
        <Brand />
        <h1>Page not found</h1>
        <p className="muted">That address does not exist in this portal.</p>
        <Link className="btn btn--primary" to="/">
          Back to the portal
        </Link>
      </div>
    </div>
  );
}
