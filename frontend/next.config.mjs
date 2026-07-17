/** @type {import('next').NextConfig} */
const nextConfig = {
    async redirects() {
        return [
            {
                source: '/verify-email',
                destination: '/auth/verify-email',
                permanent: true,
            },
        ]
    },
}

export default nextConfig
