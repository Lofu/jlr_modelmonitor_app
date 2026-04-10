import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Layout, Menu, ConfigProvider } from 'antd'
import {
  FileTextOutlined,
  BarChartOutlined,
  FolderOpenOutlined,
  RocketOutlined
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'
import ExtractPage from './pages/ExtractPage'
import AnalyzePage from './pages/AnalyzePage'
import FilesPage from './pages/FilesPage'

const { Header, Content, Sider } = Layout

function App() {
  const [collapsed, setCollapsed] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const menuItems = [
    {
      key: '/extract',
      icon: <FileTextOutlined />,
      label: 'PDF 萃取',
    },
    {
      key: '/analyze',
      icon: <BarChartOutlined />,
      label: '準確度分析',
    },
    {
      key: '/files',
      icon: <FolderOpenOutlined />,
      label: '檔案管理',
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
            background: 'rgba(255, 255, 255, 0.75)', /* 強制行內覆寫背景 */
            backdropFilter: 'blur(12px)',
            borderRight: '1px solid rgba(0, 135, 62, 0.1)'
          }}
        >
          {/* 側邊欄 Header */}
          <div style={{
            height: '48px',
            margin: '16px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            color: 'var(--gray-900)',
            fontWeight: 'bold',
            transition: 'all 0.3s',
            overflow: 'hidden'
          }}>
            <div style={{
              minWidth: '28px',
              height: '28px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #00873e 0%, #00c45e 100%)',
              boxShadow: '0 2px 6px rgba(0, 135, 62, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: collapsed ? '0' : '8px',
              flexShrink: 0
            }}>
              {/* 使用自訂的樹狀圖示感 */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 11l7-7 7 7M5 19h14" />
              </svg>
            </div>
            {!collapsed && <span style={{ whiteSpace: 'nowrap', fontSize: '15px', letterSpacing: '-0.3px', textOverflow: 'ellipsis', overflow: 'hidden' }}>法院判例模型評估系統</span>}
          </div>
          <Menu
            theme="light"
            selectedKeys={[location.pathname]}
            mode="inline"
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ background: 'transparent', border: 'none' }}
          />
        </Sider>
        <Layout style={{ 
          marginLeft: collapsed ? 80 : 220, 
          background: 'transparent',
          transition: 'margin-left 0.2s'
        }}>
          <Header style={{
            padding: '0 32px',
            display: 'flex',
            alignItems: 'center',
            fontSize: 22,
            fontWeight: 'bold',
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(0, 135, 62, 0.1)',
            boxShadow: '0 2px 8px rgba(0, 135, 62, 0.08)',
            color: 'var(--primary-green-dark)'
          }}>
            <span style={{
              background: 'linear-gradient(135deg, #00873e 0%, #006830 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              ⚖️ 法院判例模型評估系統
            </span>
          </Header>
          <Content style={{ margin: '24px 16px 0' }}>
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
            </div>
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  )
}

export default App
