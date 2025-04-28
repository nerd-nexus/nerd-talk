import { ActionResult, ActionsDef, ComputedDef } from '../core/types/public-types';
import { createLogger } from '../core/middlewares/createLogger';
import { createStore } from '../core/createStore';

// 검증 규칙 타입
interface ValidationRule {
  id: string;
  message: string;
  // eslint-disable-next-line no-use-before-define
  validate: (value: string, formState: FormState) => boolean;
}

// 폼 필드 검증 상태
interface FieldValidation {
  value: string;
  touched: boolean;
  error: string | null;
  rules: ValidationRule[]; // 필드별 검증 규칙
}

// 폼 제출 상태
type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

// 폼 상태 타입 정의
interface FormState {
  fields: {
    username: FieldValidation;
    email: FieldValidation;
    password: FieldValidation;
    confirmPassword: FieldValidation;
  };
  submitStatus: SubmitStatus;
  submitError: string | null;
}

// 폼 계산된 상태 타입 정의
interface FormComputedDef extends ComputedDef<FormState> {
  isUsernameValid: (state: FormState) => boolean;
  isEmailValid: (state: FormState) => boolean;
  isPasswordValid: (state: FormState) => boolean;
  isConfirmPasswordValid: (state: FormState) => boolean;
  isFormValid: (state: FormState) => boolean;
  allFieldsTouched: (state: FormState) => boolean;
  canSubmit: (state: FormState) => boolean;
  formData: (state: FormState) => { username: string; email: string; password: string };
  fieldErrors: (state: FormState) => Record<keyof FormState['fields'], string | null>;
}

// 폼 액션 타입 정의
interface FormActionsDef extends ActionsDef<FormState> {
  setField: (field: keyof FormState['fields'], value: string) => ActionResult<FormState>;
  touchField: (field: keyof FormState['fields']) => ActionResult<FormState>;
  touchAllFields: () => ActionResult<FormState>;
  submitForm: () => ActionResult<FormState>;
  submitSuccess: () => ActionResult<FormState>;
  submitError: (error: string) => ActionResult<FormState>;
  resetForm: () => ActionResult<FormState>;
  addValidationRule: (field: keyof FormState['fields'], rule: ValidationRule) => ActionResult<FormState>;
  removeValidationRule: (field: keyof FormState['fields'], ruleId: string) => ActionResult<FormState>;
}

// 검증 규칙
const ValidationRules = {
  required: (message = '필수 입력 항목입니다'): ValidationRule => ({
    id: 'required',
    message,
    validate: (value) => !!value.trim(),
  }),

  minLength: (length: number, message = `최소 ${length}자 이상이어야 합니다`): ValidationRule => ({
    id: `minLength-${length}`,
    message,
    validate: (value) => value.length >= length,
  }),

  email: (message = '유효한 이메일 주소를 입력하세요'): ValidationRule => ({
    id: 'email',
    message,
    validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  }),

  passwordMatch: (message = '비밀번호가 일치하지 않습니다'): ValidationRule => ({
    id: 'passwordMatch',
    message,
    validate: (value, formState) => value === formState.fields.password.value,
  }),

  containsUppercase: (message = '최소 하나의 대문자를 포함해야 합니다'): ValidationRule => ({
    id: 'containsUppercase',
    message,
    validate: (value) => /[A-Z]/.test(value),
  }),

  containsNumber: (message = '최소 하나의 숫자를 포함해야 합니다'): ValidationRule => ({
    id: 'containsNumber',
    message,
    validate: (value) => /[0-9]/.test(value),
  }),
};

// 폼 초기 상태
const initialFormState: FormState = {
  fields: {
    username: {
      value: '',
      touched: false,
      error: null,
      rules: [
        ValidationRules.required('사용자 이름을 입력하세요'),
        ValidationRules.minLength(3, '사용자 이름은 3자 이상이어야 합니다'),
      ],
    },
    email: {
      value: '',
      touched: false,
      error: null,
      rules: [ValidationRules.required('이메일을 입력하세요'), ValidationRules.email()],
    },
    password: {
      value: '',
      touched: false,
      error: null,
      rules: [
        ValidationRules.required('비밀번호를 입력하세요'),
        ValidationRules.minLength(8, '비밀번호는 8자 이상이어야 합니다'),
        ValidationRules.containsUppercase(),
        ValidationRules.containsNumber(),
      ],
    },
    confirmPassword: {
      value: '',
      touched: false,
      error: null,
      rules: [ValidationRules.required('비밀번호 확인을 입력하세요'), ValidationRules.passwordMatch()],
    },
  },
  submitStatus: 'idle',
  submitError: null,
};

// 필드 검증 함수
const validateField = (field: FieldValidation, fieldName: string, state: FormState): FieldValidation => {
  // 검증 규칙이 없으면 현재 필드 상태 반환
  if (!field.rules || field.rules.length === 0) {
    return field;
  }

  // 모든 규칙 검증
  for (const rule of field.rules) {
    if (!rule.validate(field.value, state)) {
      return {
        ...field,
        error: rule.message,
      };
    }
  }

  // 추가 검증: confirmPassword는 password와 일치해야 함
  if (fieldName === 'confirmPassword' && field.value !== state.fields.password.value) {
    return {
      ...field,
      error: '비밀번호가 일치하지 않습니다',
    };
  }

  // 모든 검증 통과
  return {
    ...field,
    error: null,
  };
};

// 모든 필드 검증 함수
const validateAllFields = (state: FormState): FormState['fields'] => {
  const validatedFields = { ...state.fields };

  for (const fieldName in validatedFields) {
    const field = validatedFields[fieldName as keyof FormState['fields']];
    validatedFields[fieldName as keyof FormState['fields']] = validateField(field, fieldName, state);
  }

  return validatedFields;
};

// 사용자 등록 폼 상태와 유효성 검사를 관리하는 스토어입니다.
export const formStore = createStore<FormState>()
  .initialState(initialFormState)
  .computed<FormComputedDef>({
    // 각 필드 유효성 검사 결과
    isUsernameValid: (state) => {
      const { username } = state.fields;
      return !username.error && username.value.length > 0;
    },

    isEmailValid: (state) => {
      const { email } = state.fields;
      return !email.error && email.value.length > 0;
    },

    isPasswordValid: (state) => {
      const { password } = state.fields;
      return !password.error && password.value.length > 0;
    },

    isConfirmPasswordValid: (state) => {
      const { confirmPassword } = state.fields;
      return !confirmPassword.error && confirmPassword.value.length > 0;
    },

    // 모든 필드 에러 모음
    fieldErrors: (state) => {
      return {
        username: state.fields.username.error,
        email: state.fields.email.error,
        password: state.fields.password.error,
        confirmPassword: state.fields.confirmPassword.error,
      };
    },

    // 전체 폼 유효성 여부
    isFormValid: (state) => {
      // 모든 필드가 에러가 없고, 값이 있는지 확인
      return Object.values(state.fields).every((field) => !field.error && field.value.length > 0);
    },

    // 모든 필드가 터치되었는지 여부
    allFieldsTouched: (state) => {
      return Object.values(state.fields).every((field) => field.touched);
    },

    // 폼 제출 가능 여부
    canSubmit: (state) => {
      // 이미 제출 중이면 제출 불가
      if (state.submitStatus === 'submitting') return false;

      // 모든 필드가 에러가 없고, 값이 있는지 확인
      return Object.values(state.fields).every((field) => !field.error && field.value.length > 0);
    },

    // 폼 데이터 (API 제출용)
    formData: (state) => {
      return {
        username: state.fields.username.value,
        email: state.fields.email.value,
        password: state.fields.password.value,
      };
    },
  })
  .actions<FormActionsDef>({
    // 필드 값 변경 및 유효성 검사
    setField: (field: keyof FormState['fields'], value: string) => (state: FormState) => {
      // 새 필드 상태 생성 (값만 업데이트)
      const updatedField: FieldValidation = {
        ...state.fields[field],
        value,
        touched: true,
      };

      // 새 상태 객체 생성
      const newState: FormState = {
        ...state,
        fields: {
          ...state.fields,
          [field]: updatedField,
        },
      };

      // 현재 필드 검증
      const validatedField = validateField(updatedField, field as string, newState);

      // password가 변경되었을 때 confirmPassword도 재검증
      if (field === 'password' && state.fields.confirmPassword.value) {
        const validatedConfirmField = validateField(state.fields.confirmPassword, 'confirmPassword', {
          ...newState,
          fields: {
            ...newState.fields,
            [field]: validatedField,
          },
        });

        return {
          fields: {
            ...state.fields,
            [field]: validatedField,
            confirmPassword: validatedConfirmField,
          },
        };
      }

      // 상태 업데이트
      return {
        fields: {
          ...state.fields,
          [field]: validatedField,
        },
      };
    },

    // 필드 터치 상태 설정
    touchField: (field: keyof FormState['fields']) => (state: FormState) => {
      const touchedField = {
        ...state.fields[field],
        touched: true,
      };

      // 터치 시 해당 필드 재검증
      const validatedField = validateField(touchedField, field as string, state);

      return {
        fields: {
          ...state.fields,
          [field]: validatedField,
        },
      };
    },

    // 모든 필드 터치 상태로 설정 (폼 제출 시)
    touchAllFields: () => (state: FormState) => {
      // 모든 필드를 터치 상태로 변경하고 검증
      const touchedFields = Object.entries(state.fields).reduce(
        (acc, [key, field]) => {
          acc[key as keyof FormState['fields']] = {
            ...field,
            touched: true,
          };
          return acc;
        },
        {} as FormState['fields'],
      );

      // 새 상태로 모든 필드 검증
      const newState = {
        ...state,
        fields: touchedFields,
      };

      return {
        fields: validateAllFields(newState),
      };
    },

    // 폼 제출 시작
    submitForm: () => (state: FormState) => {
      // 먼저 모든 필드를 터치하고 검증
      const touchedFields = Object.entries(state.fields).reduce(
        (acc, [key, field]) => {
          acc[key as keyof FormState['fields']] = {
            ...field,
            touched: true,
          };
          return acc;
        },
        {} as FormState['fields'],
      );

      const newState = {
        ...state,
        fields: touchedFields,
      };

      const validatedFields = validateAllFields(newState);

      // 모든 필드 검증 통과 여부 확인
      const isFormValid = Object.values(validatedFields).every(
        (field) => !field.error && field.value.length > 0,
      );

      // 폼이 유효하지 않으면 검증된 필드 반환
      if (!isFormValid) {
        return {
          fields: validatedFields,
        };
      }

      // 제출 상태 변경
      return {
        fields: validatedFields,
        submitStatus: 'submitting',
        submitError: null,
      };
    },

    // 폼 제출 성공
    submitSuccess: () => ({
      submitStatus: 'success',
    }),

    // 폼 제출 실패
    submitError: (error: string) => ({
      submitStatus: 'error',
      submitError: error,
    }),

    // 폼 초기화
    resetForm: () => initialFormState,

    // 검증 규칙 추가
    addValidationRule: (field: keyof FormState['fields'], rule: ValidationRule) => (state: FormState) => {
      // 이미 동일한 ID의 규칙이 있는지 확인
      const existingRuleIndex = state.fields[field].rules.findIndex((r) => r.id === rule.id);
      let updatedRules: ValidationRule[];

      if (existingRuleIndex !== -1) {
        // 기존 규칙 업데이트
        updatedRules = [...state.fields[field].rules];
        updatedRules[existingRuleIndex] = rule;
      } else {
        // 새 규칙 추가
        updatedRules = [...state.fields[field].rules, rule];
      }

      const updatedField = {
        ...state.fields[field],
        rules: updatedRules,
      };

      // 필드 값 재검증
      const newState = {
        ...state,
        fields: {
          ...state.fields,
          [field]: updatedField,
        },
      };

      const validatedField = validateField(updatedField, field as string, newState);

      return {
        fields: {
          ...state.fields,
          [field]: validatedField,
        },
      };
    },

    // 검증 규칙 제거
    removeValidationRule: (field: keyof FormState['fields'], ruleId: string) => (state: FormState) => {
      // 규칙 찾기
      const ruleIndex = state.fields[field].rules.findIndex((r) => r.id === ruleId);

      // 규칙이 없으면 상태 변경 없음
      if (ruleIndex === -1) {
        return {};
      }

      // 규칙 제거
      const updatedRules = state.fields[field].rules.filter((r) => r.id !== ruleId);

      const updatedField = {
        ...state.fields[field],
        rules: updatedRules,
      };

      // 필드 값 재검증
      const newState = {
        ...state,
        fields: {
          ...state.fields,
          [field]: updatedField,
        },
      };

      const validatedField = validateField(updatedField, field as string, newState);

      return {
        fields: {
          ...state.fields,
          [field]: validatedField,
        },
      };
    },
  })
  .middleware([createLogger()])
  .devTool('Form Validation Example')
  .build();

// 사용 예시:

// 필드 값 변경
formStore.actions.setField('username', 'john.doe');
formStore.actions.setField('email', 'john.doe@example.com');
formStore.actions.setField('password', 'Password123');
formStore.actions.setField('confirmPassword', 'Password123');

// 유효성 검사 결과 확인
console.log(formStore.computed.isUsernameValid); // true
console.log(formStore.computed.isEmailValid); // true
console.log(formStore.computed.isPasswordValid); // true
console.log(formStore.computed.isFormValid); // true

// 커스텀 검증 규칙 추가 예시
formStore.actions.addValidationRule('username', {
  id: 'no-whitespace',
  message: '사용자 이름에 공백을 포함할 수 없습니다',
  validate: (value) => !value.includes(' '),
});

// 폼 제출
if (formStore.computed.canSubmit) {
  formStore.actions.submitForm();

  // API 호출 시뮬레이션
  setTimeout(() => {
    // 성공 시
    formStore.actions.submitSuccess();

    // 또는 실패 시
    // formStore.submitError('서버 오류가 발생했습니다');
  }, 1500);
}

// 규칙 제거 예시
formStore.actions.removeValidationRule('password', 'containsUppercase');

// 폼 초기화
formStore.actions.resetForm();

// 값 변경 구독 예시
const unsubscribe = formStore.subscribeState(
  (state) => state.fields.username.value,
  (newValue, oldValue) => {
    console.log(`사용자 이름이 "${oldValue}" → "${newValue}"로 변경되었습니다.`);
  },
);

// 필드 에러 구독 예시
const unsubscribeErrors = formStore.subscribeState(
  (state) => state.fields.username.error,
  (newError) => {
    if (newError) {
      console.log(`사용자 이름 오류: ${newError}`);
    } else {
      console.log('사용자 이름 유효');
    }
  },
);

// 구독 해제
unsubscribe();
unsubscribeErrors();
