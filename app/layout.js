export const metadata = {
  title: 'PR Lead Bot',
  description: 'Служебный сервис Telegram-бота',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          padding: '48px 24px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#fafafa',
          color: '#1a1a1a',
        }}
      >
        {children}
      </body>
    </html>
  );
}
