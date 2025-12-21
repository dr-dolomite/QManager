import { GalleryVerticalEnd } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const LoginComponent = () => {
  return (
    <div className="flex flex-col gap-6">
      <form>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <a
              href="#"
              className="flex flex-col items-center gap-2 font-medium"
            >
              <div className="flex size-16 p-1 items-center justify-center rounded-md">
                <img
                  src="/qmanager-logo.svg"
                  alt="QManager Logo"
                  className="size-full"
                />
              </div>
              <span className="sr-only">QManager</span>
            </a>
            <h1 className="text-xl font-bold">Welcome to QManager</h1>
            <FieldDescription>
              Forgot your password? <a href="#">Reset it</a>
            </FieldDescription>
          </div>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              required
            />
          </Field>
          <Field>
            <Button type="submit">Login</Button>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
        and <a href="#">Privacy Policy</a>.
      </FieldDescription>
    </div>
  );
};

export default LoginComponent;
