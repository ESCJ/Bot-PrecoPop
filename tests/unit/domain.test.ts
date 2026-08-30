import { describe, expect, it } from "vitest";
import { isValidCpf, formatCpf, onlyDigits } from "../../src/domain/cpf";
import {
  formatAddress,
  formatCep,
  isValidCep,
  isValidState,
  normalizeCep,
} from "../../src/domain/cep";
import {
  formatPrice,
  parsePriceToCents,
  parseQuantity,
  percentOf,
  sumCents,
} from "../../src/domain/money";

describe("CPF", () => {
  it("aceita CPFs com dígitos verificadores válidos", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });

  it("rejeita dígitos verificadores incorretos", () => {
    expect(isValidCpf("529.982.247-26")).toBe(false);
    expect(isValidCpf("12345678900")).toBe(false);
  });

  it("rejeita sequências repetidas e tamanhos inválidos", () => {
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });

  it("formata e normaliza corretamente", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(onlyDigits("529.982.247-25")).toBe("52998224725");
    expect(formatCpf("123")).toBe("123");
  });
});

describe("CEP e endereço", () => {
  it("valida CEPs de 8 dígitos", () => {
    expect(isValidCep("01001-000")).toBe(true);
    expect(isValidCep("01001000")).toBe(true);
    expect(isValidCep("0100100")).toBe(false);
    expect(isValidCep("11111111")).toBe(false);
  });

  it("normaliza e formata", () => {
    expect(normalizeCep("01001-000")).toBe("01001000");
    expect(formatCep("01001000")).toBe("01001-000");
  });

  it("valida siglas de estado", () => {
    expect(isValidState("SP")).toBe(true);
    expect(isValidState("sp")).toBe(true);
    expect(isValidState("XX")).toBe(false);
  });

  it("monta o endereço ignorando campos vazios", () => {
    expect(
      formatAddress({
        street: "Rua das Flores",
        number: "100",
        complement: null,
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
        zipCode: "01001000",
      })
    ).toBe("Rua das Flores, 100, Centro, São Paulo - SP, CEP 01001-000");

    expect(formatAddress({ street: "Rua A", city: "Rio", state: "RJ" })).toBe("Rua A, Rio - RJ");
  });
});

describe("Valores monetários", () => {
  it("converte texto brasileiro em centavos", () => {
    expect(parsePriceToCents("19,90")).toBe(1990);
    expect(parsePriceToCents("19.90")).toBe(1990);
    expect(parsePriceToCents("R$ 19,90")).toBe(1990);
    expect(parsePriceToCents("1.234,56")).toBe(123456);
    expect(parsePriceToCents("100")).toBe(10000);
  });

  it("rejeita valores inválidos", () => {
    expect(parsePriceToCents("abc")).toBeNull();
    expect(parsePriceToCents("0")).toBeNull();
    expect(parsePriceToCents("-10")).toBeNull();
    expect(parsePriceToCents("")).toBeNull();
  });

  it("formata como moeda brasileira", () => {
    expect(formatPrice(1990).replace(/\u00a0/g, " ")).toBe("R$ 19,90");
    expect(formatPrice(0).replace(/\u00a0/g, " ")).toBe("R$ 0,00");
  });

  it("soma sem erro de ponto flutuante", () => {
    expect(sumCents([1990, 1990, 1990])).toBe(5970);
    expect(sumCents([])).toBe(0);
  });

  it("calcula percentual arredondando ao centavo", () => {
    expect(percentOf(1990, 10)).toBe(199);
    expect(percentOf(999, 15)).toBe(150);
  });

  it("valida quantidades", () => {
    expect(parseQuantity("5")).toBe(5);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("1000", 999)).toBeNull();
    expect(parseQuantity("abc")).toBeNull();
  });
});
