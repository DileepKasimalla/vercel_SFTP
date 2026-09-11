import { Link } from "react-router-dom";
import Shell from "../components/Shell";
import { Product } from "../components/ui";

export default function NotFound() {
  return (
    <Shell>
      <Product />
      <h1 className="screen-title">Page Not Found</h1>
      <div className="section">
        <p>That address does not exist in this portal.</p>
        <Link to="/">Return to the portal</Link>
      </div>
    </Shell>
  );
}
