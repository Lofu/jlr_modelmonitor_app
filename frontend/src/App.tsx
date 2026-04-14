import { useState } from 'react'
import { Layout, Menu, ConfigProvider } from 'antd'
import {
  FileTextOutlined,
  BarChartOutlined,
  FolderOpenOutlined,
  DatabaseOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import ExtractPage from './pages/ExtractPage'
import AnalyzePage from './pages/AnalyzePage'
import FilesPage from './pages/FilesPage'
import DataManagePage from './pages/DataManagePage'

const { Content, Sider } = Layout

function App() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const menuItems = [
    {
      key: '/extract',
      icon: <FileTextOutlined />,
      label: '文檔萃取',
    },
    {
      key: '/analyze',
      icon: <BarChartOutlined />,
      label: '模型評估分析',
    },
    {
      key: '/files',
      icon: <FolderOpenOutlined />,
      label: '檔案管理',
    },
    {
      key: '/data',
      icon: <DatabaseOutlined />,
      label: '資料管理',
    },
  ]

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#00873e',
          colorSuccess: '#00a651',
          colorWarning: '#ffd500',
          colorInfo: '#00873e',
          borderRadius: 12,
          fontFamily: "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif",
        },
        components: {
          Layout: {
            headerBg: 'rgba(255, 255, 255, 0.85)',
            siderBg: 'rgba(255, 255, 255, 0.75)',
            triggerBg: 'rgba(0, 135, 62, 0.04)',
            triggerColor: '#00873e',
          },
          Menu: {
            itemBg: 'transparent',
            itemSelectedBg: 'rgba(0, 135, 62, 0.12)', /* 非常淡的淺綠色底 */
            itemSelectedColor: 'var(--primary-green-dark)',
            itemHoverBg: 'rgba(0, 135, 62, 0.08)',
            itemHoverColor: 'var(--primary-green)',
            itemColor: 'var(--gray-800)',
          },
        },
      }}
    >
      {/* 波動背景 */}
      <div className="wave-background">
        {/* 整體漸層覆蓋層 */}
        <div className="gradient-overlay"></div>

        {/* 底部波浪 */}
        <svg className="waves waves-bottom" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 24 150 28" preserveAspectRatio="none" shapeRendering="auto">
          <defs>
            <path id="gentle-wave" d="M-160 44c30 0 58-18 88-18s 58 18 88 18 58-18 88-18 58 18 88 18 v44h-352z" />
          </defs>
          <g className="parallax">
            <use xlinkHref="#gentle-wave" x="48" y="0" fill="rgba(0,135,62,0.1)" />
            <use xlinkHref="#gentle-wave" x="48" y="3" fill="rgba(0,166,81,0.1)" />
            <use xlinkHref="#gentle-wave" x="48" y="5" fill="rgba(0,196,94,0.1)" />
            <use xlinkHref="#gentle-wave" x="48" y="7" fill="rgba(255,255,255,0.2)" />
          </g>
        </svg>

        {/* 中間波浪 */}
        <svg className="waves waves-middle" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 24 150 28" preserveAspectRatio="none" shapeRendering="auto">
          <defs>
            <path id="gentle-wave-middle" d="M-160 44c30 0 58-18 88-18s 58 18 88 18 58-18 88-18 58 18 88 18 v44h-352z" />
          </defs>
          <g className="parallax-middle">
            <use xlinkHref="#gentle-wave-middle" x="48" y="0" fill="rgba(255,213,0,0.06)" />
            <use xlinkHref="#gentle-wave-middle" x="48" y="3" fill="rgba(255,228,77,0.05)" />
            <use xlinkHref="#gentle-wave-middle" x="48" y="5" fill="rgba(0,166,81,0.04)" />
          </g>
        </svg>

        {/* 頂部波浪 */}
        <svg className="waves waves-top" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" viewBox="0 24 150 28" preserveAspectRatio="none" shapeRendering="auto">
          <defs>
            <path id="gentle-wave-top" d="M-160 44c30 0 58-18 88-18s 58 18 88 18 58-18 88-18 58 18 88 18 v44h-352z" />
          </defs>
          <g className="parallax-top">
            <use xlinkHref="#gentle-wave-top" x="48" y="0" fill="rgba(255,243,133,0.04)" />
            <use xlinkHref="#gentle-wave-top" x="48" y="3" fill="rgba(0,135,62,0.03)" />
          </g>
        </svg>
      </div>

      <Layout style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="light"
          width={220}
          style={{
            position: 'fixed',
            height: '100vh',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
            background: 'transparent',
            backdropFilter: 'blur(16px)',
          }}
        >
          {/* 側邊欄 Header */}
          <div style={{
            margin: '12px 10px 4px',
            borderBottom: '1px solid rgba(0, 135, 62, 0.1)',
            paddingBottom: '12px',
            overflow: 'hidden',
            transition: 'all 0.3s',
          }}>
            {!collapsed ? (
              <>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', lineHeight: 1.3, textAlign: 'center' }}>法院判例模型評估</div>
                <div style={{ fontSize: '13px', fontWeight: 400, color: '#6b7280', letterSpacing: '0.5px', marginTop: '2px', textAlign: 'center' }}>Model Monitor</div>
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#111827', textAlign: 'center', lineHeight: 1.3 }}>評估</div>
              </div>
            )}
          </div>
          <Menu
            theme="light"
            selectedKeys={[location.pathname]}
            mode="inline"
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ background: 'transparent', border: 'none' }}
          />

          {/* 側邊欄底部 Logo */}
          {!collapsed && (
            <div style={{
              position: 'absolute',
              bottom: 48,
              left: 0,
              right: 0,
              padding: '12px 16px',
              borderTop: '1px solid rgba(0, 135, 62, 0.1)',
            }}>
              <img
                src="/cathay-logo.jpg"
                alt="國泰世華銀行"
                style={{ width: '100%', objectFit: 'contain', display: 'block' }}
              />
            </div>
          )}
        </Sider>
        <Layout style={{
          marginLeft: collapsed ? 80 : 220,
          background: 'transparent',
          transition: 'margin-left 0.2s'
        }}>
          <Content style={{ margin: '20px 20px 0' }}>
            <div
              style={{
                padding: 24,
                minHeight: 360,
                background: 'transparent',
              }}
            >
              {/* 使用 display 控制顯示，避免 component unmount 導致丟失 WebSocket 連線與萃取進度 */}
              <div style={{ display: (location.pathname === '/' || location.pathname === '/extract') ? 'block' : 'none' }}>
                <ExtractPage />
              </div>
              <div style={{ display: location.pathname === '/analyze' ? 'block' : 'none' }}>
                <AnalyzePage />
              </div>
              <div style={{ display: location.pathname === '/files' ? 'block' : 'none' }}>
                <FilesPage />
              </div>
              <div style={{ display: location.pathname === '/data' ? 'block' : 'none' }}>
                <DataManagePage />
              </div>
            </div>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}

export default App
