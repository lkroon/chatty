/** Response body of `GET /api/auth/me` (200 case; 401 when logged out). */
export interface AuthUser {
  email: string;
  name: string;
  picture: string;
}
