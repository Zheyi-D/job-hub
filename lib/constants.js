// ================================================================
// JobHub — 全局常量
// af_ 前缀 = 简历填充    |    jt_ 前缀 = 投递追踪
// ================================================================

export const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

// ---------- Storage Keys ----------
export const STORAGE_KEYS = {
  // 简历填充
  profiles:       'af_profiles',        // storage.local：多份简历
  activeProfileId:'af_activeProfileId',  // storage.local：当前激活的简历 id

  // 投递追踪
  config:         'jt_config',           // storage.local：飞书凭证 + 字段映射
  history:        'jt_history',          // storage.local：本地投递历史
  draft:          'jt_draft',            // storage.session：侧边栏表单草稿
  token:          'jt_token'             // storage.session：tenant_access_token 缓存
};

export const GITHUB_REPO_URL = 'https://github.com/Zheyi-D/job-hub';
export const HISTORY_LIMIT = 500;

// ---------- 默认空简历模板 ----------
export function createEmptyProfile(name) {
  return {
    id: crypto.randomUUID(),
    name: name || '我的简历',
    categories: [
      { id: 'basic',      name: '基本信息', icon: '👤',
        fields: [
          { label: '姓名', value: '' },
          { label: '手机', value: '' },
          { label: '邮箱', value: '' },
          { label: '城市', value: '' },
          { label: '求职意向', value: '' },
          { label: '个人链接', value: '' }
        ] },
      { id: 'education',  name: '教育背景', icon: '🎓',
        fields: [
          { label: '学校1', value: '' }, { label: '学位1', value: '' },
          { label: '专业1', value: '' }, { label: '时间1', value: '' },
          { label: 'GPA 1', value: '' }, { label: '荣誉1', value: '' },
          { label: '课程1', value: '' },
          { label: '学校2', value: '' }, { label: '学位2', value: '' },
          { label: '专业2', value: '' }, { label: '时间2', value: '' },
          { label: 'GPA 2', value: '' }, { label: '荣誉2', value: '' },
          { label: '课程2', value: '' }
        ] },
      { id: 'internship', name: '实习经历', icon: '💼',
        fields: [
          { label: '公司1', value: '' }, { label: '岗位1', value: '' },
          { label: '时间1', value: '' }, { label: '描述1', value: '' },
          { label: '公司2', value: '' }, { label: '岗位2', value: '' },
          { label: '时间2', value: '' }, { label: '描述2', value: '' },
          { label: '公司3', value: '' }, { label: '岗位3', value: '' },
          { label: '时间3', value: '' }, { label: '描述3', value: '' }
        ] },
      { id: 'project',    name: '项目经历', icon: '🚀',
        fields: [
          { label: '项目1', value: '' }, { label: '角色1', value: '' },
          { label: '描述1', value: '' },
          { label: '项目2', value: '' }, { label: '角色2', value: '' },
          { label: '描述2', value: '' },
          { label: '项目3', value: '' }, { label: '角色3', value: '' },
          { label: '描述3', value: '' }
        ] },
      { id: 'campus',     name: '校园经历', icon: '📚',
        fields: [
          { label: '组织/活动1', value: '' }, { label: '角色1', value: '' },
          { label: '描述1', value: '' },
          { label: '组织/活动2', value: '' }, { label: '角色2', value: '' },
          { label: '描述2', value: '' }
        ] },
      { id: 'skills',     name: '技能 & 其他', icon: '🛠️',
        fields: [
          { label: '编程语言', value: '' },
          { label: '工具/框架', value: '' },
          { label: '语言能力', value: '' },
          { label: '证书', value: '' },
          { label: '兴趣爱好', value: '' }
        ] }
    ],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// ---------- 飞书字段映射 ----------
export const DEFAULT_FIELD_MAP = {
  company:   '公司',
  position:  '岗位',
  appliedAt: '投递时间',
  link:      '链接',
  status:    '状态',
  note:      '备注'
};

export const REQUIRED_FIELDS = ['company', 'position', 'appliedAt', 'link', 'status'];
export const EXPECTED_FIELD_TYPES = {
  company:   1,   // 文本
  position:  1,   // 文本
  appliedAt: 5,   // 日期
  link:      15,  // 超链接
  status:    3    // 单选
};

export const FIELD_TYPE_NAMES = {
  1: '文本', 2: '数字', 3: '单选', 4: '多选', 5: '日期', 7: '复选框',
  11: '人员', 13: '电话号码', 15: '超链接', 17: '附件', 18: '单向关联',
  20: '公式', 21: '双向关联', 22: '地理位置', 23: '群组',
  1001: '创建时间', 1002: '最后更新时间', 1003: '创建人', 1004: '修改人', 1005: '自动编号'
};

export const STATUS_OPTIONS = [
  '已投递', '测评', '笔试', '一面', '二面', '三面', 'HR面', 'Offer', '已挂', '已拒绝'
];

// ---------- 看板配色（Neo-Brutalist 纯色） ----------
export const DASHBOARD_COLORS = {
  applied:    '#3366ff',   // 已投递 — 蓝
  testing:    '#ffcc00',   // 测评/笔试 — 黄
  interview:  '#7b2fbe',   // 面试中 — 紫
  offer:      '#00d4aa',   // Offer — 绿
  rejected:   '#555555',   // 已挂/已拒绝 — 灰
  cardTotal:  '#000000',   // 总投递卡片 — 黑底白字
  cardActive: '#ffcc00',   // 进行中卡片 — 黄
  cardInterview: '#7b2fbe',// 面试中卡片 — 紫
  cardOffer:  '#00d4aa'    // Offer卡片 — 绿
};

// ---------- 面试相关状态 ----------
export const INTERVIEW_STATUSES = new Set(['一面', '二面', '三面', 'HR面']);
export const CLOSED_STATUSES = new Set(['已挂', '已拒绝', 'Offer']);
