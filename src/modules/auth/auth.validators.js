'use strict';
const { z } = require('../../utils/schemas');

const email = z.string().trim().toLowerCase().email('Email không hợp lệ').max(191);
const password = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .max(72, 'Mật khẩu tối đa 72 ký tự')
  .regex(/[A-Za-z]/, 'Mật khẩu cần có chữ cái')
  .regex(/\d/, 'Mật khẩu cần có chữ số');

const register = z.object({
  email,
  password,
  fullName: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự').max(120),
});

const login = z.object({
  email,
  password: z.string().min(1, 'Vui lòng nhập mật khẩu').max(72),
});

const changePassword = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: password,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
    path: ['newPassword'],
  });

module.exports = { register, login, changePassword };
