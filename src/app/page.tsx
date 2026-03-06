import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { verifyJWT, COOKIE_NAME } from '@/lib/auth';

export default async function Home() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyJWT(token) : null;

    if (payload) {
        redirect('/top');
    } else {
        redirect('/login');
    }
}
